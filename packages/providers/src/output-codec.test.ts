import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PelDataSchemaV1} from '@foreman/pel';
import {lowerProviderSchema,providerSchemaSubset} from './output.js';
test('T-M3-028 admitted custom schemas still reject unsupported endpoint structure',()=>{
 const optional:PelDataSchemaV1={type:'association',additionalKeys:false,fields:[{key:'x',required:false,schema:{type:'boolean'}}]};
 const data:PelDataSchemaV1={type:'data',maxDepth:2,maxBytes:100};
 const list:PelDataSchemaV1={type:'list',minItems:0,maxItems:257,items:{type:'boolean'}};
 const number:PelDataSchemaV1={type:'number',integer:true,minimum:0,maximum:1};
 for(const [content,subset] of [[optional,providerSchemaSubset('openai-responses')],[data,providerSchemaSubset('google-interactions')],[list,providerSchemaSubset('xai-responses')],[number,{...providerSchemaSubset('openai-responses'),supportsNumericBounds:false,weakenings:[]}]] as const){
 const result=lowerProviderSchema({id:'custom',content},subset,{custom:content});assert.equal(result.ok,false);if(!result.ok){assert.equal(result.error._tag,'UnsupportedCapability');assert.notEqual(result.error.fieldPath,'outputSchema.id');}
 }
});
test('T-M3-028 built-in Boolean schema lowers without replacing the Pel registry built-in',()=>{
 const result=lowerProviderSchema({id:'schema:pel-boolean-v1',content:{type:'boolean'}},providerSchemaSubset('codex-app-server'));assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.value.jsonSchema,{type:'object',properties:{value:{type:'boolean'}},required:['value'],additionalProperties:false});
});
test('T-M3-028 OpenAI rejects documented depth and enum complexity ceilings before dispatch',()=>{
 let nested:PelDataSchemaV1={type:'boolean'};for(let i=0;i<11;i++)nested={type:'pair',key:'x',value:nested};
 const depth=lowerProviderSchema({id:'deep',content:nested},providerSchemaSubset('openai-responses'),{deep:nested});assert.equal(depth.ok,false);
 const longEnum:PelDataSchemaV1={type:'string',maxBytes:100,enum:Array.from({length:251},(_,i)=>`${i}${'x'.repeat(61)}`)};
 assert.equal(lowerProviderSchema({id:'enum',content:longEnum},providerSchemaSubset('openai-responses'),{enum:longEnum}).ok,false);
});
