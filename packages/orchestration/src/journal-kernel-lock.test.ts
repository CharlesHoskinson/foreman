import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer, type RunId } from '@foreman/event-log';

const worker = `
import { writeFileSync } from 'node:fs';
import { Effect } from 'effect';
import { RunJournal, makeLiveRunJournalLayer } from './packages/event-log/src/run-journal.ts';
const [root, marker] = process.argv.slice(1);
await Effect.runPromise(Effect.gen(function*(){const journal=yield* RunJournal;return yield* journal.transact('kernel-journal',()=>({_tag:'Append',draft:{type:'kernel.transaction.v1',lane:'kernel',payload:{}},result:event=>event}));}).pipe(Effect.provide(makeLiveRunJournalLayer(root,{afterJournalWriteSync:()=>{writeFileSync(marker,'held');for(;;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}}))));
`;
test('T-M4-004 SIGKILL inside journal transaction releases kernel ownership and preserves committed sequence', async () => {
 const root=mkdtempSync(join(tmpdir(),'journal-kernel-')),marker=join(root,'held');
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',worker,root,marker],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 const read=()=>Effect.runPromise(Effect.flatMap(RunJournal,journal=>journal.transact('kernel-journal' as RunId,events=>({_tag:'Return',value:events}))).pipe(Effect.provide(makeLiveRunJournalLayer(root,{lockBoundMs:30})),Effect.either));
 try{
  const deadline=Date.now()+10000;while(!existsSync(marker)&&Date.now()<deadline&&child.exitCode===null)await delay(20);assert.equal(existsSync(marker),true,stderr);
  const competing=await read();assert.equal(competing._tag,'Left');if(competing._tag==='Left')assert.equal(competing.left.reason,'journal_busy');
  child.kill('SIGKILL');await closed;
  const recovered=await read();assert.equal(recovered._tag,'Right',JSON.stringify(recovered));if(recovered._tag!=='Right')return;assert.equal(recovered.right.length,1);assert.equal(recovered.right[0]!.seq,1);
  const path=join(root,'runs','kernel-journal','locks','events.lock','owner-v1.lock'),inode=statSync(path).ino;
  await read();assert.equal(statSync(path).ino,inode);assert.equal(readFileSync(join(root,'runs','kernel-journal','events.ndjson'),'utf8').trim().split('\n').length,1);
 }finally{child.kill('SIGKILL');await closed;rmSync(root,{recursive:true,force:true});}
});

import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { executionContractSha256, strictEndstopLimits, type ExecutionContractV1 } from './execution-contract.js';
const contract:ExecutionContractV1={schemaVersion:1,contractId:'kernel-ledger',packageId:'kernel-test',objectiveSha256:'a'.repeat(64),acceptanceSha256:'b'.repeat(64),baseCommit:'a'.repeat(40),allowedPathsSha256:'c'.repeat(64),dependencyContractIds:[],authorizationSha256:'a'.repeat(64),createdAt:'2026-08-05T12:00:00Z',deadlineAt:'2026-08-05T14:00:00Z',limits:strictEndstopLimits,requiredMilestones:['checks']};
const command={_tag:'ReserveAction' as const,action:'implement' as const,candidateSha256:'b'.repeat(64),reservationId:'kernel-reservation',at:'2026-08-05T12:01:00Z'};
const ledgerWorker=`
import { writeFileSync } from 'node:fs';
import { Effect } from 'effect';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './packages/orchestration/src/execution-ledger.ts';
const [root,marker,contractId,contractHash,command] = process.argv.slice(1);
await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.execute(contractId,contractHash,JSON.parse(command))).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root,{afterJournalWriteSync:()=>{writeFileSync(marker,'held');for(;;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}}))));
`;
test('T-M4-019 SIGKILL inside ledger reservation preserves one debit and releases transaction ownership',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-kernel-')),marker=join(root,'held');
 await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.create(contract)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',ledgerWorker,root,marker,contract.contractId,executionContractSha256(contract),JSON.stringify(command)],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 const layer=makeLiveEndstopLedgerLayer(root,{lockBoundMs:30});
 try{
  const deadline=Date.now()+15000;while(!existsSync(marker)&&Date.now()<deadline&&child.exitCode===null)await delay(20);assert.equal(existsSync(marker),true,stderr);
  const busy=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.status(contract.contractId)).pipe(Effect.provide(layer),Effect.either));assert.equal(busy._tag,'Left');
  child.kill('SIGKILL');await closed;
  const state=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.status(contract.contractId)).pipe(Effect.provide(layer)));assert.equal(state.counts.implement,1);
  await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.execute(contract.contractId,executionContractSha256(contract),command)).pipe(Effect.provide(layer)));
  const repeated=await Effect.runPromise(Effect.flatMap(EndstopLedger,ledger=>ledger.status(contract.contractId)).pipe(Effect.provide(layer)));assert.equal(repeated.counts.implement,1);
  const lines=readFileSync(join(root,'runs',contract.contractId,'events.ndjson'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as {seq:number});assert.deepEqual(lines.map(line=>line.seq),[1,2]);
 }finally{child.kill('SIGKILL');await closed;rmSync(root,{recursive:true,force:true});}
});

for (const legacy of ['file', 'directory'] as const) test(`Journal preserves an unknown legacy ${legacy} lock and fails closed`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'journal-legacy-')),locks=join(root,'runs','legacy','locks'),path=join(locks,'events.lock');
 try{mkdirSync(locks,{recursive:true});if(legacy==='file')writeFileSync(path,'',{mode:0o600});else mkdirSync(path,{mode:0o700});const inode=statSync(path).ino;
  const result=await Effect.runPromise(Effect.flatMap(RunJournal,journal=>journal.transact('legacy' as RunId,events=>({_tag:'Return',value:events}))).pipe(Effect.provide(makeLiveRunJournalLayer(root,{lockBoundMs:10})),Effect.either));
  assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left.reason,'journal_busy');assert.equal(statSync(path).ino,inode);
 }finally{rmSync(root,{recursive:true,force:true});}
});
