/** Pel workflow control checks use scripted receipts, not live provider or publication evidence. */
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {Effect} from 'effect';
import {decodeForemanProjectV1} from './pel-project-config.js';
import {PelRuntime,type PelRuntimePorts,type HostContextV1} from './pel-run-contract.js';
import {resolvePelTaskArtifacts} from './pel-host-evidence.js';
import {checkPel, createAuthoringSnapshotV1, parsePel, startPel, resumePel, createPelEnvironment, validateDataSchema,
  type PelDataValue, type PelValue, type HostRequestV1, type PelStep, type AuthoringSnapshotV1} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';

const root='examples/pel/k-release';
const snapshot=createDefaultAuthoringSnapshotV1();
const registry=snapshot.registry;
const text=(value:string):PelDataValue=>({tag:'string',value});
const nil:PelDataValue={tag:'nil'};
const list=(items:readonly PelDataValue[]=[]):PelDataValue=>({tag:'list',items});
const bool=(value:boolean):PelDataValue=>({tag:'boolean',value});
const assoc=(fields:Record<string,PelDataValue>):PelDataValue=>list(Object.entries(fields).map(([key,value])=>({tag:'pair',key,value})));
function field(value:PelValue,key:string):PelValue {
  assert.equal(value.tag,'list');
  if(value.tag!=='list')throw Error('not an association');
  const item=value.items.find(x=>x.tag==='pair'&&x.key===key);
  assert.ok(item?.tag==='pair',key);
  return item.value;
}
function string(value:PelValue):string {assert.equal(value.tag,'string');if(value.tag!=='string')throw Error('not a string');return value.value;}
function task(round:number,noChange=false):PelDataValue{return assoc({status:text(noChange?'no-change':'candidate-ready'),candidate:noChange?nil:text(`artifact:candidate-${round}`),artifacts:list(),'implementation-receipt':text(`artifact:implementation-${round}`),findings:noChange?list([text('recorded-no-change-reason')]):list()});}
function verified(candidate:PelDataValue,passed:boolean):PelDataValue{return assoc({status:text(passed?'verified':'verification-failed'),passed:bool(passed),candidate:field(candidate,'candidate') as PelDataValue,task:candidate,verification:text('artifact:verification'),checks:list(),findings:passed?list():list([text('check-failed-reason')])});}
function reviewed(verification:PelDataValue,approved:boolean):PelDataValue{return assoc({status:text(approved?'approved':'changes-requested'),approved:bool(approved),candidate:field(verification,'candidate') as PelDataValue,verification,review:text('artifact:review'),verdict:text(approved?'approved':'changes-requested'),findings:approved?list():list([text('review-rejected-reason')])});}
interface Scenario {readonly checks?:readonly boolean[];readonly reviews?:readonly boolean[];readonly noChangeAt?:number;readonly failHost?:string;}
function execute(file:string,scenario:Scenario={}) {
  const source=readFileSync(`${root}/${file}`);
  const parsed=parsePel(source);assert.ok(parsed.ok);if(!parsed.ok)throw Error('parse');
  let step=startPel(parsed.value,createPelEnvironment(registry));
  const requests:HostRequestV1[]=[];let tasks=0,checks=0,reviews=0;
  for(let n=0;step.tag==='suspend'&&n<30;n++){
    assert.equal(step.ready.length,1,'workflow effects must be sequential');
    const request=step.ready[0];assert.ok(request);requests.push(request);
    const input=request.boundArguments.input;
    let value:PelDataValue;
    if(scenario.failHost===request.registryId){
      step=resumePel(parsed.value,registry,step.continuation,[{requestId:request.requestId,outcome:{tag:'failure',failure:{code:'provider-failure',message:'recorded failure'}}}]);
      break;
    }
    switch(request.registryId){
      case 'fm/checkpoint':value=assoc({name:request.boundArguments.name as PelDataValue,sequence:{tag:'number',value:n}});break;
      case 'fm/task':tasks++;value=task(tasks,scenario.noChangeAt===tasks);break;
      case 'fm/verify':assert.ok(input);checks++;value=verified(input as PelDataValue,scenario.checks?.[checks-1]??true);break;
      case 'fm/review':assert.ok(input);reviews++;value=reviewed(input as PelDataValue,scenario.reviews?.[reviews-1]??true);break;
      default:throw Error(`Unexpected effect ${request.registryId}`);
    }
    assert.ok(registry.dataSchemas[request.expectedResultSchemaId]);
    assert.ok(validateDataSchema(value,registry.dataSchemas[request.expectedResultSchemaId]!),request.registryId+' receipt schema');
    step=resumePel(parsed.value,registry,step.continuation,[{requestId:request.requestId,outcome:{tag:'success',value}}]);
  }
  assert.notEqual(step.tag,'suspend','bounded workflow must terminate');
  if(step.tag==='done')assert.ok(validateDataSchema(step.value,registry.dataSchemas['schema:delivery-final-v1']!));
  return {step,requests,tasks,checks,reviews};
}
function done(step:PelStep):PelValue{assert.equal(step.tag,'done');if(step.tag!=='done')throw Error(JSON.stringify(step));return step.value;}

test('K release Pel agenda covers every OpenSpec package and preserves prerequisite order',()=>{
  const source=readFileSync(`${root}/agenda.pel`);const p=parsePel(source);assert.ok(p.ok);if(!p.ok)return;
  const step=startPel(p.value,createPelEnvironment(registry));const value=done(step);
  const plan=JSON.parse(readFileSync('openspec/changes/pel-k-release-program/coverage.json','utf8')) as {packages:{id:string;requiredForK1:boolean;dependsOn:string[];requirements:string[]}[];programRequirements:string[];m7ExecutionOwners:Record<string,string>};
  for(const track of ['k1','k2']){
    const stages=field(value,track);assert.equal(stages.tag,'list');if(stages.tag!=='list')return;
    const seen=new Set(track==='k2'?plan.packages.filter(p=>p.requiredForK1).map(p=>p.id):[]);
    if(track==='k1')assert.equal(stages.items.length,11);else assert.equal(stages.items.length,1);
    for(const stage of stages.items){const id=string(field(stage,'package'));const entry=plan.packages.find(p=>p.id===id);
      if(id!=='pel-k-release-program'){assert.ok(entry,id);for(const dep of entry.dependsOn)assert.ok(seen.has(dep),`${id} requires ${dep}`);}
      const members=(key:string)=>{const v=field(stage,key);assert.equal(v.tag,'list');return v.tag==='list'?v.items.map(string):[];};
      assert.deepEqual(members('depends-on'),entry?.dependsOn??[]);
      assert.deepEqual(members('requirements'),entry?.requirements??plan.programRequirements);
      assert.deepEqual(members('inherited').sort(),Object.entries(plan.m7ExecutionOwners).filter(([,owner])=>owner===id).map(([r])=>r).sort());
      assert.ok(!seen.has(id),`duplicate ${id}`);seen.add(id);
      const file=string(field(stage,'workflow'));assert.ok(readFileSync(`${root}/${file}`).length>0);
      assert.ok(readFileSync(`openspec/changes/${id}/tasks.md`).length>0);
    }
  }
});

test('All fourteen Pel sources check under the default snapshot',()=>{
  const files=readdirSync(root).filter(f=>f.endsWith('.pel'));assert.equal(files.length,14);
  for(const file of files)assert.equal(checkPel({source:readFileSync(root+'/'+file),snapshot}).tag,'ok',file);
});

test('Every K package workflow checks, approves the verified candidate, and never publishes',()=>{
  const files=readdirSync(root).filter(f=>/^\d\d-.*\.pel$/.test(f));assert.equal(files.length,12);
  for(const file of files){const checked=checkPel({source:readFileSync(`${root}/${file}`),snapshot});assert.equal(checked.tag,'ok',`${file}: ${JSON.stringify(checked)}`);
    const result=execute(file);const request=result.requests.find(r=>r.registryId==='fm/task');assert.ok(request);
    assert.equal(string(request.boundArguments.id!),'implement');assert.equal(string(request.boundArguments.input!),'artifact:approved-spec');
    const normalize=(name:string)=>readFileSync(root+'/'+name,'utf8').replace(/^;.*$/gm,'').replace(/:name "[^"]+"/,':name "PACKAGE"');
    assert.equal(normalize(file),normalize('01-foundation.pel'));
    assert.equal(string(field(done(result.step),'status')),'approved');assert.deepEqual([result.tasks,result.checks,result.reviews],[1,1,1]);
    assert.deepEqual(result.requests.map(r=>r.registryId),['fm/checkpoint','fm/task','fm/verify','fm/review']);
    assert.equal(string(field(done(result.step),'candidate')),'artifact:candidate-1');
  }
});

test('Failed verification stops for correction context before any review',()=>{
  const r=execute('01-foundation.pel',{checks:[false,false]});assert.equal(string(field(done(r.step),'reason')),'correction-context-required');assert.deepEqual([r.tasks,r.checks,r.reviews],[1,1,0]);assert.deepEqual(field(done(r.step),'findings'),list([text('check-failed-reason')]));
});

test('A rejected review preserves its evidence and requests an explicitly rebound correction',()=>{
  const r=execute('01-foundation.pel',{reviews:[false]});assert.deepEqual(field(done(r.step),'findings'),list([text('review-rejected-reason')]));assert.equal(string(field(done(r.step),'reason')),'correction-context-required');assert.deepEqual([r.tasks,r.checks,r.reviews],[1,1,1]);assert.equal(string(field(done(r.step),'candidate')),'artifact:candidate-1');
});

test('Initial no-change stops before verification and review',()=>{
  const r=execute('01-foundation.pel',{noChangeAt:1});assert.equal(string(field(done(r.step),'reason')),'no-product-change');assert.deepEqual([r.tasks,r.checks,r.reviews],[1,0,0]);
});

test('Correction reads an explicitly bound artifact and verifies its own candidate',()=>{
  const r=execute('correction.pel');const request=r.requests.find(x=>x.registryId==='fm/task');assert.ok(request);
  assert.equal(string(request.boundArguments.id!),'correct');assert.equal(string(request.boundArguments.input!),'artifact:approved-spec');
  assert.equal(string(field(done(r.step),'status')),'approved');assert.deepEqual([r.tasks,r.checks,r.reviews],[1,1,1]);
});

test('A no-change correction returns its own diagnostic without another attempt',()=>{
  const r=execute('correction.pel',{noChangeAt:1});assert.equal(string(field(done(r.step),'reason')),'no-product-change');assert.ok(JSON.stringify(field(done(r.step),'findings')).includes('recorded-no-change-reason'));assert.deepEqual([r.tasks,r.checks,r.reviews],[1,0,0]);
});

for(const failingHost of ['fm/task','fm/verify','fm/review'])test(failingHost+' failure terminates without blind retries or fabricated completion',()=>{
  const r=execute('01-foundation.pel',{failHost:failingHost});assert.equal(r.step.tag,'failed');assert.equal(r.requests.at(-1)?.registryId,failingHost);
});

test('A missing receipt stays pending with its original request identity',()=>{
  const p=parsePel(readFileSync(`${root}/01-foundation.pel`));assert.ok(p.ok);if(!p.ok)return;
  const first=startPel(p.value,createPelEnvironment(registry));assert.equal(first.tag,'suspend');if(first.tag!=='suspend')return;
  const next=resumePel(p.value,registry,first.continuation,[]);assert.equal(next.tag,'suspend');if(next.tag!=='suspend')return;
  assert.equal(next.ready[0].requestId,first.ready[0].requestId);assert.equal(next.ready[0].alreadyEmitted,true);
});

test('The Opus and Grok configuration fragment resolves without substituting model cells',()=>{
  const patch=JSON.parse(readFileSync(root+'/settings.patch.json','utf8')) as {roleBindings:AuthoringSnapshotV1['roleBindings']};
  const configured=createAuthoringSnapshotV1({...snapshot,roleBindings:patch.roleBindings});
  assert.ok(configured.ok,JSON.stringify(configured));if(!configured.ok)return;
  assert.equal(patch.roleBindings['role:implementer']?.profileId,'claude-opus-5');
  assert.equal(patch.roleBindings['role:reviewer']?.profileId,'grok-4.6');
  for(const file of readdirSync(root).filter(f=>f.endsWith('.pel'))){const checked=checkPel({source:readFileSync(root+'/'+file),snapshot:configured.value});assert.equal(checked.tag,'ok',file+': '+JSON.stringify(checked));}
});

test('Malformed intermediate receipts fail instead of becoming valid final deliveries',()=>{
  const p=parsePel(readFileSync(`${root}/01-foundation.pel`));assert.ok(p.ok);if(!p.ok)return;
  const first=startPel(p.value,createPelEnvironment(registry));assert.equal(first.tag,'suspend');if(first.tag!=='suspend')return;
  const result=resumePel(p.value,registry,first.continuation,[{requestId:first.ready[0].requestId,outcome:{tag:'success',value:text('not-a-checkpoint-result')}}]);
  assert.equal(result.tag,'failed');if(result.tag==='failed')assert.equal(result.diagnostic.code,'PEL_HOST_RESULT');
});

test('Beta regression: only a bare admitted artifact input resolves to content',async()=>{
  const descriptor=snapshot.artifactDescriptors.find(x=>x.id==='artifact:approved-spec');assert.ok(descriptor);
  const context={checked:{snapshot},binding:{limits:{maxOutputBytes:65536}},effect:{requestId:'beta-input-probe'}} as unknown as HostContextV1;
  const resolve=(input:PelDataValue)=>Effect.runPromise(resolvePelTaskArtifacts(input,context).pipe(Effect.provideService(PelRuntime,{} as PelRuntimePorts)));
  const direct=await resolve(text('artifact:approved-spec'));assert.equal(direct.length,1);assert.deepEqual(direct[0]?.content,descriptor.content);
  const nested=assoc({spec:text('artifact:approved-spec'),delivery:reviewed(verified(task(1),true),false)});
  const ordinary=await resolve(nested);assert.equal(ordinary.length,1);assert.equal(ordinary[0]?.id,'pel:task-input');
  assert.deepEqual(ordinary[0]?.content,JSON.parse(JSON.stringify(nested)));
  assert.notDeepEqual(ordinary[0]?.content,descriptor.content);
});

test('The settings fragment leaf merge preserves bounds and passes the complete project decoder',()=>{
  const base=JSON.parse(readFileSync('examples/pel/project-settings.json','utf8'));
  const patch=JSON.parse(readFileSync(root+'/settings.patch.json','utf8'));
  const merged={...base,...patch,limits:{...base.limits,...patch.limits,execution:{...base.limits.execution,...patch.limits.execution}}};
  const decoded=decodeForemanProjectV1(merged);assert.ok(decoded.ok,JSON.stringify(decoded));
  assert.equal(merged.limits.maxCostUsd,base.limits.maxCostUsd);
  assert.equal(merged.limits.execution.wallTimeMs,base.limits.execution.wallTimeMs);
  assert.equal(merged.limits.execution.totalActions,4);
  assert.equal(decodeForemanProjectV1({...merged,limits:{...merged.limits,execution:{...merged.limits.execution,unrecognizedCeiling:1}}}).ok,false);
});
