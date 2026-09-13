import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Effect} from 'effect';
import {makeForemanCli} from './pel-authoring-cli.js';
import type {AuthoringServices} from './pel-authoring-contract.js';
import type {RunResultV1} from './pel-run-contract.js';
import type {RunId,AttemptIdentity} from '@foreman/event-log';

function fixture() {
  const out: string[] = [], err: string[] = [], calls: string[] = [];
  const result:RunResultV1 = {schemaVersion:1,runId:'run-1' as RunId,state:'needs-action',resumeMode:'final-value',externalOutcome:'none',updatedAt:1,
    programDigest:'a'.repeat(64),attempt:{runId:'run-1',laneId:'pel',attemptId:1} as AttemptIdentity,finalValue:{tag:'number',value:42},artifacts:[],receipts:[],outputs:[],
    usage:{observed:{providerCounters:{}},reservedCostUsd:0,unresolvedEffectIds:[],counters:{sourceBytes:2,tokens:1,astNodes:1,syntaxDepthPeak:1,reductions:1,iterations:0,callDepthPeak:0,valueBytesPeak:8}},diagnostics:[]};
  const services:AuthoringServices = {input:{read:()=>Effect.succeed(Buffer.from('42'))},output:{stdout:t=>Effect.sync(()=>{out.push(t);}),stderr:t=>Effect.sync(()=>{err.push(t);})},context:{defaultSnapshotPath:'unused'},
    lifecycle:{run:input=>Effect.gen(function*(){yield* input.started('run-1');calls.push('dispatch');return result;}),
      resume:()=>Effect.succeed(result),status:()=>Effect.sync(()=>{calls.push('status');return {schemaVersion:1 as const,runId:result.runId,state:'running' as const,externalOutcome:'none' as const,updatedAt:1};}),
      cancel:()=>Effect.sync(()=>{calls.push('cancel');return {schemaVersion:1 as const,runId:result.runId,state:'cancel-requested' as const,externalOutcome:'none' as const,updatedAt:1};}),configure:()=>Effect.void}};
  return {out,err,calls,services,cli:makeForemanCli(services)};
}
test('T-M4-001 lifecycle announces durable run before dispatch and emits one final JSON value',async()=>{
  const f=fixture();
  const result=await Effect.runPromise(f.cli.run(['run','program.pel','--json']));
  assert.equal(result.exitCode,3);assert.equal(f.out.length,1);assert.equal(JSON.parse(f.out[0]!).runId,'run-1');
  assert.deepEqual(JSON.parse(f.err[0]!),{type:'run-started',runId:'run-1',state:'running'});assert.deepEqual(f.calls,['dispatch']);
});
test('T-M4-015 status and cancellation preserve pending exit 5 and never call run',async()=>{
  for(const command of ['status','cancel']){const f=fixture();assert.equal((await Effect.runPromise(f.cli.run([command,'run-1','--json']))).exitCode,5);assert.deepEqual(f.calls,[command]);assert.equal(f.out.length,1);}
});
test('T-M4-021 invalid lifecycle flags and malformed IDs fail before any service call',async()=>{
  for(const args of [['run','p','--fixture','x'],['status','../run'],['resume','run-1','--revision','x'],['cancel','run-1','--json','--json']]){
    const f=fixture();assert.equal((await Effect.runPromise(f.cli.run([...args,'--json']))).exitCode,2);assert.deepEqual(f.calls,[]);
  }
});
