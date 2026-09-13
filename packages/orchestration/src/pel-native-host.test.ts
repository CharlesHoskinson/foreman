import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPelPrint, makePelPredicateRequest } from './pel-native-host.js';
import type { HostContextV1 } from './pel-run-contract.js';
test('T-M4-020 print returns identical vals and honors separator and newline', () => {
 const vals={tag:'list' as const,items:[{tag:'number' as const,value:1},{tag:'number' as const,value:2}]};
 const formatted=formatPelPrint({vals,sep:{tag:'string',value:','},nl:{tag:'boolean',value:true}});
 assert.equal(formatted.ok,true); if(formatted.ok){assert.deepEqual(formatted.value.value,vals);assert.equal(formatted.value.text,'1,2\n');}
 assert.equal(formatPelPrint({vals:{tag:'syntax',node:{} as never}}).ok,false);
});
test('T-M4-019 predicate V1 authority is rejected before provider request construction', () => {
 const context={binding:{authority:{kind:'v1'}},checked:{snapshot:{nlConditionProfile:null}}} as unknown as HostContextV1;
 assert.equal(makePelPredicateRequest({boundArguments:{}} as never,context,'transport-v1','reservation').ok,false);
});

import { checkPel, createPelEnvironment, startPel } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { validateResolvedHostRequest } from './pel-effects.js';
test('T-M4-020 native string condition binds the exact profile, transport, Boolean schema and no tools',()=>{
 const snapshot=createDefaultAuthoringSnapshotV1(),check=checkPel({source:Buffer.from('(case 2 ["is even" #t #t #f])'),snapshot});assert.equal(check.tag,'ok');if(check.tag!=='ok')throw Error('check');
 const step=startPel(check.checked.program,createPelEnvironment(snapshot.registry),snapshot.limits,snapshot.options);assert.equal(step.tag,'suspend');if(step.tag!=='suspend')throw Error('step');const request=step.ready[0]!;
 const context={checked:check.checked,effect:{requestId:request.requestId,effectId:'predicate'},binding:{authority:{kind:'v2-child'},sourceDigest:check.checked.sourceDigest,checkedProgramDigest:check.checked.bindingDigest,registryDigest:snapshot.registryDigest,limits:{deadline:Date.now()+1000,maxInputTokens:100,maxOutputTokens:20,maxCostUsd:1,maxOutputBytes:1000}}} as unknown as HostContextV1;
 assert.equal(validateResolvedHostRequest(request,context).ok,true);
 const built=makePelPredicateRequest(request,context,'v1','existing-evaluate');assert.equal(built.ok,true);if(built.ok){assert.equal(built.value.profileId,snapshot.nlConditionProfile?.profileId);assert.equal(built.value.transportId,snapshot.nlConditionProfile?.transportId);assert.equal(built.value.outputSchema.id,'schema:pel-boolean-v1');assert.deepEqual(built.value.toolPolicy,{mode:'none'});assert.equal(built.value.limits.maxToolCalls,0);assert.equal(built.value.limits.spendReservationRef,'existing-evaluate');}
 assert.equal(validateResolvedHostRequest({...request,selection:{...request.selection!,profileId:'grok-4.6'}},context).ok,false);
});
