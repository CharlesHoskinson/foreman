import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Deferred, Effect } from 'effect';
import { createHostRegistry, createPelEnvironment, DEFAULT_LIMITS, DEFAULT_RUN_OPTIONS, parsePel, startPel } from '@foreman/pel';
import type { HostReceiptV1 } from '@foreman/pel';
import { drivePelEvaluation } from './pel-runner.js';

function initial(source: string) {
  const registry = createHostRegistry(); assert.ok(registry.ok);
  const parsed = parsePel(Buffer.from(source)); assert.ok(parsed.ok);
  return { registry: registry.value, step: startPel(parsed.value, createPelEnvironment(registry.value), DEFAULT_LIMITS, DEFAULT_RUN_OPTIONS) };
}
test('T-M4-006 ready batches join alreadyEmitted work and return the last source value', async () => {
  const f = initial('(do/async (print 1) (print 2) (print 3))');
  const calls: number[] = [], completions: number[] = [], boundaries: number[] = [];
  let active = 0, peak = 0;
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(2);
    const secondDone = yield* Deferred.make<void>();
    return yield* drivePelEvaluation(f.step, {
      persist: step => Effect.sync(() => { boundaries.push(step.counters.reductions); }),
      dispatch: request => semaphore.withPermits(1)(Effect.gen(function* () {
        const value = request.boundArguments.vals!; assert.equal(value.tag, 'number');
        const n = value.value as number;
        assert.ok(boundaries.length > 0, 'suspension must precede dispatch');
        calls.push(n); active++; peak = Math.max(peak, active);
        if (n === 1) yield* Deferred.await(secondDone);
        if (n === 2) yield* Deferred.succeed(secondDone, undefined);
        yield* Effect.yieldNow();
        active--; completions.push(n);
        return { kind: 'settled' as const, receipt: { requestId: request.requestId, outcome: { tag: 'success', value } } as HostReceiptV1 };
      })),
    });
  })));
  assert.equal(result.step.tag, 'done');
  if (result.step.tag === 'done') assert.deepEqual(result.step.value, { tag: 'number', value: 3 });
  assert.deepEqual([...calls].sort(), [1, 2, 3]);
  assert.equal(peak, 2); assert.equal(completions[0], 2);
  assert.ok(boundaries.length >= 2, 'partial receipt must persist next evaluator boundary');
});
test('T-M4-006 native do dispatches in source order', async () => {
  const f = initial('(do (print 1) (print 2) (print 3))'); const calls: number[] = [];
  const result = await Effect.runPromise(Effect.scoped(drivePelEvaluation(f.step, {
    persist: () => Effect.void,
    dispatch: request => Effect.sync(() => {
      const value = request.boundArguments.vals!; assert.equal(value.tag, 'number'); calls.push(value.value as number);
      return { kind: 'settled' as const, receipt: { requestId: request.requestId, outcome: { tag: 'success', value } } as HostReceiptV1 };
    }),
  })));
  assert.deepEqual(calls, [1,2,3]); assert.equal(result.step.tag, 'done');
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPel, decodePelContinuation, hashAuthoringContent, PEL_PROFILE } from '@foreman/pel';
import { makeLiveRunJournalLayer } from '@foreman/event-log';
import type { RunId } from '@foreman/event-log';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { PelRuntime } from './pel-run-contract.js';
import type { ExecutionBindingV1, ForemanProjectV1, PelOwnedRunContextV1, PelRuntimePorts } from './pel-run-contract.js';
import { strictEndstopLimits } from './execution-contract.js';
import { appendPelRecord, appendPelEffectResult, makeLivePelArtifactPort, readPelRecords, replayPelRun, decodePelChildStateV1 } from './pel-journal.js';
import { drivePelRun, putPelRunData, withPelRunOwner, pelRunnerFailure } from './pel-runner.js';
import { makePelControlHandlers } from './pel-control-functions.js';
import { makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { RunLease } from './supervisor.js';

function runFixture(source:string, configure?:(ports:PelRuntimePorts,context:PelOwnedRunContextV1)=>PelRuntimePorts) {
  const root=mkdtempSync(join(tmpdir(),'pel-owner-'));
  const snapshot=createDefaultAuthoringSnapshotV1();
  const admitted=checkPel({source:Buffer.from(source),snapshot}); assert.equal(admitted.tag,'ok'); if(admitted.tag!=='ok') throw Error(JSON.stringify(admitted));
  const checked=admitted.checked;
  const ref={artifactId:'sha256-'+ 'a'.repeat(64),sha256:'a'.repeat(64),byteLength:0};
  const repository={gitCommonDir:root,identitySha256:'a'.repeat(64)};
  const grant={grantId:'grant-1',repository,worktreeId:'worktree-1',canonicalRoot:root,directoryIdentity:'fixture',immutableBase:'a'.repeat(40),writablePaths:['.']};
  const limits={execution:strictEndstopLimits,pel:snapshot.limits,deadline:Date.now()+100000,maxConcurrentEffects:1,maxInputTokens:1000,maxOutputTokens:1000,maxToolCalls:0,maxOutputBytes:65536,maxCostUsd:1,cancellationObservationMs:10,maxReplayReductions:100000};
  const binding={schemaVersion:1,evidenceKind:'test-fixture',runId:'run-owner' as RunId,attempt:{runId:'run-owner',laneId:'pel',attemptId:1},contractId:'contract-1',contractSha256:'a'.repeat(64),authority:{kind:'v1',authoritySha256:'a'.repeat(64),authorityRef:ref},authoritySha256:'a'.repeat(64),checkedProgramDigest:checked.bindingDigest,revisionDigest:checked.sourceDigest,sourceDigest:checked.sourceDigest,snapshotDigest:snapshot.snapshotDigest,registryDigest:snapshot.registryDigest,configurationDigest:'a'.repeat(64),runtimeVersion:'1',languageProfileId:PEL_PROFILE.id,languageProfileDigest:PEL_PROFILE.digest,runtimeHandlerVersion:'1',stateRoot:root,ownerLeaseRef:'lease:run-owner',repository,artifacts:{source:ref,snapshot:ref,registry:ref,configuration:ref},options:snapshot.options,optionsDigest:checked.optionsDigest,resultContract:{schemaId:'schema:pel-data-v1',schemaSha256:hashAuthoringContent(snapshot.registry.dataSchemas['schema:pel-data-v1']),classification:'generic'},limits,requiredMilestones:[]} as unknown as ExecutionBindingV1;
  const project={schemaVersion:1,projectId:'project',repository,stateRoot:root,workspaces:{grants:[grant],maxWorktrees:3,maxRaceContenders:3,poolRoot:root,immutableBase:grant.immutableBase},limits} as unknown as ForemanProjectV1;
  const context={binding,project,snapshot,registry:snapshot.registry,contract:{},owner:{runId:binding.runId,release:()=>Effect.void}} as PelOwnedRunContextV1;
  const ports:PelRuntimePorts={artifacts:makeLivePelArtifactPort(root),resources:{resolve:()=>Effect.succeed({reads:[],writes:[]}),acquire:()=>Effect.void,acquireConcurrency:()=>Effect.void,allocateContenders:(_,count)=>Effect.succeed(Array.from({length:count},(_,offset)=>({...grant,grantId:`grant-${offset+1}`,worktreeId:`worktree-${offset+1}`})))},providers:{resolve:()=>Effect.die('unexpected provider'),permissions:{}} as unknown as PelRuntimePorts['providers'],clock:{now:Effect.sync(Date.now),sleep:Effect.sleep},handlers:new Map(),controls:makePelControlHandlers(),output:()=>Effect.void,loadRunInputs:()=>Effect.succeed(context),hostEvidence:()=>Effect.succeed({milestones:[],receiptRefs:[]}),validateDecisionAuthority:()=>Effect.die('unexpected decision')};
  const configured=configure?configure(ports,context):ports;
  const run=Effect.gen(function* () {
    const bindingRef=yield* putPelRunData(binding,binding); yield* appendPelRecord(binding,'pel.run.v1',{bindingRef});
    const result=yield* drivePelRun({kind:'fresh',checked,binding},context);
    return {result,events:yield* readPelRecords(binding.runId)};
  }).pipe(Effect.scoped,Effect.provideService(PelRuntime,configured),Effect.provide(makeLiveRunJournalLayer(root)),Effect.provide(makeLiveEndstopLedgerLayer(root)),Effect.provideService(RunLease,{acquire:()=>Effect.die('already-held driver must not acquire')}));
  return {root,run,binding,checked,context,ports:configured};
}
test('T-M4-012 checkpoint returns the durable journal sequence and resumes lexical captures',async()=>{
  const fixture=runFixture('(do (fm/checkpoint :name "captured") 9)');
  try {const {result,events}=await Effect.runPromise(fixture.run);assert.equal(result.state,'succeeded');assert.deepEqual(result.finalValue,{tag:'number',value:9});assert.equal(events.filter(event=>event.type==='pel.checkpoint.v1').length,1);} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 retry evaluates a captured pure closure exactly once on success',async()=>{
  const fixture=runFixture('(fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] 7))');
  try {const {result,events}=await Effect.runPromise(fixture.run);assert.equal(result.state,'succeeded');assert.deepEqual(result.finalValue,{tag:'number',value:7});assert.ok(events.some(event=>event.type==='pel.child-suspension.v1'));} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-008 race commits source-order tie winner at concurrency one',async()=>{
  const fixture=runFixture('(fm/race :tasks [(lambda [] 11) (lambda [] 22)] :winner "first-valid")');
  try {const {result,events}=await Effect.runPromise(fixture.run);assert.equal(result.state,'succeeded');assert.equal(result.finalValue?.tag,'list');if(result.finalValue?.tag==='list') assert.deepEqual(result.finalValue.items[0],{tag:'pair',key:'winner-index',value:{tag:'number',value:1}});assert.equal(events.filter(event=>event.type==='pel.race.decision.v1').length,1);} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-001 the owner acquires once, releases once, and rejects a competing lease',async()=>{
  const fixture=runFixture('1'); let acquires=0,releases=0;
  try {
    assert.equal(await Effect.runPromise(withPelRunOwner(fixture.binding,()=>Effect.succeed(7)).pipe(Effect.provideService(RunLease,{acquire:()=>Effect.sync(()=>{acquires++;return {_tag:'Held' as const,release:()=>Effect.sync(()=>{releases++;})};})}))),7);
    assert.equal(acquires,1);assert.equal(releases,1);
    const busy=await Effect.runPromise(Effect.either(withPelRunOwner(fixture.binding,()=>Effect.die('must not execute')).pipe(Effect.provideService(RunLease,{acquire:()=>Effect.succeed({_tag:'Busy'})})))); assert.equal(busy._tag,'Left');
  } finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 transient retry uses distinct one-based child identities and stable prior operation links',async()=>{
  const contexts:import('./pel-run-contract.js').HostContextV1[]=[];
  const fixture=runFixture('(fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] (print 7)))',(ports)=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
    contexts.push(context);
    const receipt:HostReceiptV1={requestId:request.requestId,outcome:contexts.length===1?{tag:'failure',failure:{code:'provider-failure',message:'limited',cause:{providerFailure:{_tag:'RateLimited',retryClass:'transient',message:'limited'}}}}:{tag:'success',value:{tag:'number',value:7}}};
    const receiptRef=yield* appendPelEffectResult(context.binding,context.effect,receipt);return {kind:'settled' as const,receipt,receiptRef};
  })}]])}));
  try {const {result}=await Effect.runPromise(fixture.run);assert.equal(result.state,'succeeded');assert.equal(contexts.length,2);assert.match(contexts[0]!.childInvocationId!,/\/retry\/1$/);assert.match(contexts[1]!.childInvocationId!,/\/retry\/2$/);assert.equal(contexts[1]!.effect.retryOrdinal,1);assert.equal(contexts[1]!.effect.priorEffectId,contexts[0]!.effect.effectId);assert.equal(contexts[0]!.retryContext!.logicalOperationKey,contexts[1]!.retryContext!.logicalOperationKey);assert.ok(result.usage.counters.reductions>0);} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-011 durable local cancellation waits for owner-scope cleanup',async()=>{
  let cleaned=false;
  const fixture=runFixture('(print 7)',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
    yield* Effect.addFinalizer(()=>Effect.sync(()=>{cleaned=true;}));
    yield* appendPelRecord(context.binding,'pel.cancel.v1',{requestedAt:Date.now()});
    return yield* Effect.never;
  })}]])}));
  try {const {result,events}=await Effect.runPromise(fixture.run);assert.equal(cleaned,true);assert.equal(result.state,'cancelled');assert.equal(result.externalOutcome,'none');assert.equal(events.filter(event=>event.type==='pel.cancel.v1').length,1);} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-010 an unknown external cancellation stays visible after local cleanup',async()=>{
  let cleaned=false;
  const fixture=runFixture('(print 7)',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
    const ref=yield* putPelRunData(context.binding,{observation:'unknown'});
    yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest:'a'.repeat(64),reservation:null,usageReservation:null});
    yield* Effect.addFinalizer(()=>appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef:ref,providerIdentity:null,externalOutcome:'unknown'}).pipe(Effect.orDie,Effect.tap(()=>Effect.sync(()=>{cleaned=true;}))));
    yield* appendPelRecord(context.binding,'pel.cancel.v1',{requestedAt:Date.now()});
    return yield* Effect.never;
  })}]])}));
  try {const {result}=await Effect.runPromise(fixture.run);assert.equal(cleaned,true);assert.equal(result.state,'needs-action');assert.equal(result.externalOutcome,'unknown');assert.ok(result.usage.unresolvedEffectIds.length>0);assert.equal(result.diagnostics[0]?.code,'unknown-external-outcome');assert.ok(result.diagnostics[0]?.effectId);assert.equal(result.diagnostics[0]?.sourceSpan?.line,1);assert.equal(result.diagnostics[0]?.retryable,false);assert.match(result.diagnostics[0]?.nextAction??'',/reconcil/i);} finally {rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-015 a local reconciliation wait identifies its source without claiming external dispatch',async()=>{
 const fixture=runFixture('(print 7)',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){const observationRef=yield* putPelRunData(context.binding,{reason:'fixture-local-grant'});yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'none'});return {kind:'waiting' as const,pendingRequestId:request.requestId,reason:'reconciliation-required' as const,observationRef};})}]])}));
 try{const {result}=await Effect.runPromise(fixture.run);assert.equal(result.state,'needs-action');assert.equal(result.externalOutcome,'none');assert.equal(result.diagnostics[0]?.code,'reconciliation-required');assert.equal(result.diagnostics[0]?.sourceSpan?.line,1);assert.ok(result.diagnostics[0]?.effectId);assert.equal(result.diagnostics[0]?.retryable,false);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-015 a confirmed provider cancellation receipt returns cancelled instead of failed',async()=>{
 const fixture=runFixture('(print 7)',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){const cancellation={requested:true,acknowledged:true,localCleanup:'complete',remoteOutcome:'cancelled'};const observationRef=yield* putPelRunData(context.binding,{cancellation});yield* appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'confirmed-cancelled'});const receipt:HostReceiptV1={requestId:request.requestId,outcome:{tag:'failure',failure:{code:'cancelled',message:'Provider cancellation and local cleanup are confirmed.',cause:{cancellation}}}};return {kind:'settled' as const,receipt,receiptRef:yield* appendPelEffectResult(context.binding,context.effect,receipt)};})}]])}));
 try{const {result}=await Effect.runPromise(fixture.run);assert.equal(result.state,'cancelled');assert.equal(result.externalOutcome,'none');assert.equal(result.diagnostics[0]?.code,'cancelled');assert.equal(result.diagnostics[0]?.sourceSpan?.line,1);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 admitted budget exhaustion retains a durable failed result after cleanup',async()=>{
 let cleaned=false;
 const fixture=runFixture('(print 7)',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
  yield* Effect.addFinalizer(()=>Effect.sync(()=>{cleaned=true;}));
  const ref=yield* putPelRunData(context.binding,{input:'over budget'});
  yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest:'a'.repeat(64),reservation:null,usageReservation:{maxInputTokens:1001,maxOutputTokens:1,maxCostUsd:0}});
  return yield* Effect.die('Budget refusal must prevent dispatch');
 })}]])}));
 try{const {result,events}=await Effect.runPromise(fixture.run);assert.equal(cleaned,true);assert.equal(result.state,'failed');assert.equal(result.externalOutcome,'none');assert.equal(result.diagnostics[0]?.code,'budget-exhausted');assert.equal(result.diagnostics[0]?.sourceSpan?.line,1);assert.ok(result.diagnostics[0]?.effectId);assert.ok(result.usage.counters.reductions>0);assert.deepEqual(result.usage.unresolvedEffectIds,[]);assert.equal(events.filter(event=>event.type==='pel.run-result.v1').length,1);assert.equal(events.filter(event=>event.type==='pel.effect.intent.v1').length,0);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 an already expired owner writes a durable failure without evaluating or dispatching',async()=>{
 const fixture=runFixture('(print 7)',(ports,context)=>({...ports,clock:{...ports.clock,now:Effect.succeed(context.binding.limits.deadline)},output:()=>Effect.die('Expired execution must not dispatch')}));
 try{const {result,events}=await Effect.runPromise(fixture.run);assert.equal(result.state,'failed');assert.equal(result.diagnostics[0]?.code,'budget-exhausted');assert.equal(result.usage.counters.reductions,0);assert.equal(result.usage.counters.iterations,0);assert.equal(events.filter(event=>event.type==='pel.run-result.v1').length,1);assert.equal(events.filter(event=>event.type==='pel.suspension.v1').length,0);assert.equal(events.filter(event=>event.type==='pel.effect.intent.v1').length,0);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 an expired recovered owner retains unknown child effects and exact committed counters',async()=>{
 let expired=false,dispatches=0;
 const fixture=runFixture('(fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] (print 7)))',(ports,context)=>({...ports,clock:{...ports.clock,now:Effect.suspend(()=>Effect.succeed(expired?context.binding.limits.deadline:Date.now()))},controls:new Map([...ports.controls,['print',{execute:(request,host)=>Effect.gen(function*(){
  assert.equal(expired,false);dispatches++;
  const observationRef=yield* putPelRunData(host.binding,{external:'unknown'});
  yield* appendPelRecord(host.binding,'pel.effect.intent.v1',{effect:host.effect,argumentsRef:observationRef,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest:'a'.repeat(64),reservation:null,usageReservation:null});
  yield* appendPelRecord(host.binding,'pel.effect.observed.v1',{effectId:host.effect.effectId,observationRef,providerIdentity:null,externalOutcome:'unknown'});
  return {kind:'waiting' as const,pendingRequestId:request.requestId,reason:'unknown-external-outcome' as const,observationRef};
 })}]])}));
 try{const first=await Effect.runPromise(fixture.run);assert.equal(first.result.state,'needs-action');expired=true;const result=await Effect.runPromise(recoverOwnerFixture(fixture));assert.equal(result.state,'needs-action');assert.equal(result.externalOutcome,'unknown');assert.equal(result.diagnostics[0]?.code,'budget-exhausted');assert.deepEqual(result.usage.counters,first.result.usage.counters);assert.equal(result.usage.unresolvedEffectIds.length,1);assert.equal(dispatches,1);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-009 concurrent budget exhaustion preserves an unknown external effect after cleanup',async()=>{
 let cleaned=false;
 const admitted=await Effect.runPromise(Deferred.make<void>());
 const fixture=runFixture('(do/async (print 1) (print 2))',ports=>({...ports,controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
  const value=request.boundArguments.vals!,first=value.tag==='number'&&value.value===1;
  const ref=yield* putPelRunData(context.binding,{input:value});
  if(!first)yield* Deferred.await(admitted);
  yield* appendPelRecord(context.binding,'pel.effect.intent.v1',{effect:context.effect,argumentsRef:ref,expectedResultSchemaId:request.expectedResultSchemaId,preparationDigest:'a'.repeat(64),reservation:null,usageReservation:{maxInputTokens:600,maxOutputTokens:1,maxCostUsd:0}});
  yield* Effect.addFinalizer(()=>appendPelRecord(context.binding,'pel.effect.observed.v1',{effectId:context.effect.effectId,observationRef:ref,providerIdentity:null,externalOutcome:'unknown'}).pipe(Effect.orDie,Effect.tap(()=>Effect.sync(()=>{cleaned=true;}))));
  yield* Deferred.succeed(admitted,undefined);
  return yield* Effect.never;
 })}]])}));
 try{const {result,events}=await Effect.runPromise(fixture.run);assert.equal(cleaned,true);assert.equal(result.state,'needs-action');assert.equal(result.externalOutcome,'unknown');assert.equal(result.diagnostics[0]?.code,'budget-exhausted');assert.equal(result.usage.unresolvedEffectIds.length,1);assert.equal(events.filter(event=>event.type==='pel.run-result.v1').length,1);assert.equal(events.filter(event=>event.type==='pel.effect.intent.v1').length,1);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-008 recovery reuses a committed race winner and grants without evaluating contenders again',async()=>{
  let allocations=0,fail=true;
  const fixture=runFixture('(fm/race :tasks [(lambda [] 11) (lambda [] 22)] :winner "first-valid")',ports=>({...ports,
    artifacts:{...ports.artifacts,put:(runId,bytes,max,protection)=>Effect.suspend(()=>{
      const value=JSON.parse(Buffer.from(bytes).toString('utf8')) as {outcome?:{value?:{items?:{key?:string}[]}}};
      if(fail&&value.outcome?.value?.items?.[0]?.key==='winner-index') return Effect.fail(pelRunnerFailure('journal-write-failed','injected interruption after race decision'));
      return ports.artifacts.put(runId,bytes,max,protection);
    })},resources:{...ports.resources,allocateContenders:(context,count)=>{allocations++;assert.equal(allocations,1);return ports.resources.allocateContenders(context,count);}}
  }));
  try {
    const interrupted=await Effect.runPromise(Effect.either(fixture.run));assert.equal(interrupted._tag,'Left');fail=false;
    const recovered=Effect.gen(function*(){
      const replay=replayPelRun(yield* readPelRecords(fixture.binding.runId));assert.ok(replay.ok);assert.ok(replay.value.suspensionRef);
      const saved=JSON.parse(Buffer.from(yield* fixture.ports.artifacts.get(fixture.binding.runId,replay.value.suspensionRef,64000000)).toString('utf8')) as import('./pel-run-contract.js').PelSuspensionV1;
      const continuation=decodePelContinuation(yield* fixture.ports.artifacts.get(fixture.binding.runId,saved.continuationRef,64000000),{sourceDigest:fixture.binding.sourceDigest,profileDigest:fixture.binding.languageProfileDigest,registryDigest:fixture.binding.registryDigest,optionsDigest:fixture.binding.optionsDigest});assert.ok(continuation.ok);
      const children=new Map<string,import('./pel-run-contract.js').PelChildStateV1>();
      for(const record of replay.value.children){const decoded=decodePelChildStateV1(JSON.parse(Buffer.from(yield* fixture.ports.artifacts.get(fixture.binding.runId,record.childRef,64000000)).toString('utf8')));assert.ok(decoded.ok);children.set(decoded.value.childInvocationId,{...decoded.value,lastCounterChargeSequence:record.sequence});}
      const result=yield* drivePelRun({kind:'recovered',checked:fixture.checked,binding:fixture.binding,continuation:continuation.value,receipts:[],children:[...children.values()]},fixture.context);
      return {result,events:yield* readPelRecords(fixture.binding.runId)};
    }).pipe(Effect.scoped,Effect.provideService(PelRuntime,fixture.ports),Effect.provide(makeLiveRunJournalLayer(fixture.root)),Effect.provide(makeLiveEndstopLedgerLayer(fixture.root)),Effect.provideService(RunLease,{acquire:()=>Effect.die('no second lease')}));
    const {result,events}=await Effect.runPromise(recovered);assert.equal(result.state,'succeeded');assert.equal(allocations,1);assert.equal(events.filter(event=>event.type==='pel.race.decision.v1').length,1);
  }finally{rmSync(fixture.root,{recursive:true,force:true});}
});
function recoverOwnerFixture(fixture:ReturnType<typeof runFixture>) {
 return Effect.gen(function*(){
  const replay=replayPelRun(yield* readPelRecords(fixture.binding.runId));assert.ok(replay.ok);assert.ok(replay.value.suspensionRef);
  const saved=JSON.parse(Buffer.from(yield* fixture.ports.artifacts.get(fixture.binding.runId,replay.value.suspensionRef,64000000)).toString('utf8')) as import('./pel-run-contract.js').PelSuspensionV1;
  const continuation=decodePelContinuation(yield* fixture.ports.artifacts.get(fixture.binding.runId,saved.continuationRef,64000000),{sourceDigest:fixture.binding.sourceDigest,profileDigest:fixture.binding.languageProfileDigest,registryDigest:fixture.binding.registryDigest,optionsDigest:fixture.binding.optionsDigest});assert.ok(continuation.ok);
  const children=new Map<string,import('./pel-run-contract.js').PelChildStateV1>();
  for(const record of replay.value.children){const decoded=decodePelChildStateV1(JSON.parse(Buffer.from(yield* fixture.ports.artifacts.get(fixture.binding.runId,record.childRef,64000000)).toString('utf8')));assert.ok(decoded.ok);children.set(decoded.value.childInvocationId,{...decoded.value,lastCounterChargeSequence:record.sequence});}
  return yield* drivePelRun({kind:'recovered',checked:fixture.checked,binding:fixture.binding,continuation:continuation.value,receipts:[],children:[...children.values()]},fixture.context);
 }).pipe(Effect.scoped,Effect.provideService(PelRuntime,fixture.ports),Effect.provide(makeLiveRunJournalLayer(fixture.root)),Effect.provide(makeLiveEndstopLedgerLayer(fixture.root)),Effect.provideService(RunLease,{acquire:()=>Effect.die('no second lease')}));
}
test('T-M4-009 restart after attempt one preserves the total bound and prior operation mapping',async()=>{
 let fail=true;const contexts:import('./pel-run-contract.js').HostContextV1[]=[];
 const fixture=runFixture('(fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] (print 7)))',ports=>({...ports,
  artifacts:{...ports.artifacts,put:(runId,bytes,max,protection)=>Effect.suspend(()=>{
    if(fail&&Buffer.from(bytes).toString('utf8').includes('/retry/2/root')) return Effect.fail(pelRunnerFailure('journal-write-failed','injected interruption allocating retry two'));
    return ports.artifacts.put(runId,bytes,max,protection);
  })},controls:new Map([...ports.controls,['print',{execute:(request,context)=>Effect.gen(function*(){
    contexts.push(context);const receipt:HostReceiptV1={requestId:request.requestId,outcome:context.retryContext?.attemptIndex===1?{tag:'failure',failure:{code:'provider-failure',message:'limited',cause:{providerFailure:{_tag:'RateLimited',retryClass:'transient',message:'limited'}}}}:{tag:'success',value:{tag:'number',value:7}}};
    const receiptRef=yield* appendPelEffectResult(context.binding,context.effect,receipt);return {kind:'settled' as const,receipt,receiptRef};
  })}]])
 }));
 try {
   assert.equal((await Effect.runPromise(Effect.either(fixture.run)))._tag,'Left');assert.equal(contexts.length,1);fail=false;
   const result=await Effect.runPromise(recoverOwnerFixture(fixture));assert.equal(result.state,'succeeded');assert.equal(contexts.length,2);assert.equal(contexts[1]!.retryContext!.attemptIndex,2);assert.equal(contexts[1]!.effect.priorEffectId,contexts[0]!.effect.effectId);
 }finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('nested controls allocate inside their parent child allowance without double reserving ancestors',async()=>{
 const fixture=runFixture('(fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] (fm/retry :attempts 2 :on [\':rate-limited] :body (lambda [] 7))))');
 try{const {result}=await Effect.runPromise(fixture.run);assert.equal(result.state,'succeeded');assert.deepEqual(result.finalValue,{tag:'number',value:7});}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-008 race wrappers do not occupy the only nested effect permit',async()=>{
 const semaphore=await Effect.runPromise(Effect.makeSemaphore(1));let active=0,peak=0;
 const fixture=runFixture('(fm/race :tasks [(lambda [] (fm/checkpoint "one")) (lambda [] (fm/checkpoint "two"))] :winner "first-valid")',ports=>{
   const checkpoint=ports.controls.get('fm/checkpoint')!;
   return {...ports,controls:new Map([...ports.controls,['fm/checkpoint',{execute:(request,context,parent,driver)=>semaphore.withPermits(1)(Effect.gen(function*(){active++;peak=Math.max(peak,active);yield* Effect.yieldNow();const result=yield* checkpoint.execute(request,context,parent,driver);active--;return result;}))}]])};
 });
 try{const {result}=await Effect.runPromise(fixture.run.pipe(Effect.timeout('3 seconds')));assert.equal(result.state,'succeeded');assert.equal(peak,1);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('T-M4-008 a local-only loser is cleaned up and does not invent an unknown remote outcome',async()=>{
 let cleaned=false;
 const fixture=runFixture('(fm/race :tasks [(lambda [] (fm/checkpoint "one")) (lambda [] (fm/checkpoint "two"))] :winner "first-valid")',ports=>{
  const checkpoint=ports.controls.get('fm/checkpoint')!;return {...ports,controls:new Map([...ports.controls,['fm/checkpoint',{execute:(request,context,parent,driver)=>request.boundArguments.name?.tag==='string'&&request.boundArguments.name.value==='two'?Effect.gen(function*(){yield* Effect.addFinalizer(()=>Effect.sync(()=>{cleaned=true;}));return yield* Effect.never;}):checkpoint.execute(request,context,parent,driver)}]])};
 });
 try{const {result}=await Effect.runPromise(fixture.run.pipe(Effect.timeout('3 seconds')));assert.equal(cleaned,true);assert.equal(result.state,'succeeded');assert.equal(JSON.stringify(result.finalValue).includes('"unknown"'),false);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
