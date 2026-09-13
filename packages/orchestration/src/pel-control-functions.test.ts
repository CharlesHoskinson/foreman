import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostEffectFailure, PelValue } from '@foreman/pel';
import { decodeRetrySelectors, retryCategory, retryLogicalOperationKey } from './pel-control-functions.js';
test('T-M4-009 accepts evaluated quoted keys and rejects syntax, nil pairs and unknown selectors', () => {
  assert.deepEqual(decodeRetrySelectors({tag:'list',items:[{tag:'key',name:'rate-limited'},{tag:'key',name:'transport-disconnected'}]}), {ok:true,value:['rate-limited','transport-disconnected']});
  for(const value of [{tag:'nil'},{tag:'list',items:[{tag:'pair',key:'rate-limited',value:{tag:'nil'}}]},{tag:'list',items:[{tag:'key',name:'authentication-required'}]}] as PelValue[]) assert.equal(decodeRetrySelectors(value).ok,false);
});
test('T-M4-009 only canonical transient failures with safe outcomes can retry', () => {
  const failure = (tag:string,extra:object = {}):HostEffectFailure => ({code:'provider-failure',message:'provider stopped',cause:{providerFailure:{_tag:tag,retryClass:['RateLimited','TransportDisconnected'].includes(tag)?'transient':'never',message:'stopped'},...extra}});
  assert.equal(retryCategory(failure('RateLimited')),'rate-limited');
  assert.equal(retryCategory(failure('TransportDisconnected')),null);
  assert.equal(retryCategory(failure('TransportDisconnected',{confirmedNoDispatch:true})),'transport-disconnected');
  for (const tag of ['ModelUnavailable','ModelMismatch','UnsupportedCapability','CapabilityUnverified','PromptChannelUnsupported','AuthenticationRequired','ProbeUnknown','OutputInvalid','OutputIncomplete','MalformedEvent','ContinuationMismatch','ResumeUnavailable','OutcomeUnknown']) assert.equal(retryCategory(failure(tag)),null);
  assert.equal(retryCategory({code:'timeout',message:'timeout'}),null);
});
test('T-M4-009 logical operation key preserves nested call and loop identity, removes only its retry ordinal', () => {
  assert.equal(retryLogicalOperationKey('parent','parent/retry/1/root/call/4/loop/2'),'parent/root/call/4/loop/2');
  assert.equal(retryLogicalOperationKey('parent','parent/retry/2/root/call/4/loop/2'),'parent/root/call/4/loop/2');
  assert.notEqual(retryLogicalOperationKey('parent','parent/retry/2/root/call/4/loop/3'),'parent/root/call/4/loop/2');
});
