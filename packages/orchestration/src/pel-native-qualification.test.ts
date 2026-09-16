import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,readdir,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Deferred,Effect,Stream} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {resolveProfile,type ProviderEventV1,type ProviderIdentityV1,type ProviderTransport,type ToolRequestV1} from '@foreman/providers';
import {runNativeCodingQualification} from './pel-native-qualification.js';
import {makeLiveProviderCliServices} from './pel-provider-live.js';
import type {ProviderQualificationSelection} from './pel-provider-cli.js';
const resolved=resolveProfile('grok-4.6');if(!resolved.ok)throw Error('profile');const profile=resolved.value;
function selection():ProviderQualificationSelection{return {profileId:'grok-4.6',transportId:'grok-acp',credentialProfileRef:'fixture:account',controls:{...profile.defaults,toolChoice:'auto'},limits:{deadline:Date.now()+30000,maxInputTokens:1000,maxOutputTokens:1000,maxOutputBytes:65536,maxCostUsd:0.1,maxToolCalls:2,spendReservationRef:'fixture:qualification'},binding:{kind:'qualification-fixture',fixtureManifestHash:'a'.repeat(64),endpointIdentity:'fake://native-coding',evidenceRef:'fixture:coding',expiresAt:Date.now()+60000},requiredCapabilities:['generation','structuredOutput','codingTask','tools','permissionBoundary','workspaceBoundary']};}
for(const scenario of ['exact','ignored-extra','late-write','auth-failure','no-tools'] as const)test(`native coding qualification uses actual mount probes, durable permission, and exact changed bytes: ${scenario}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'foredi-qualification-test-'));
 try{
  let editedWorkspace='';let durableBeforeAck=false;let admittedTask:string|undefined;
  const node=await realpath(process.execPath);
  const report=await Effect.runPromise(runNativeCodingQualification(selection(),{stateRoot:join(root,'state'),worktreeRoot:root,userHome:root,environment:{}},{installed:{executable:node,nodeExecutable:node,bwrapPath:'/usr/bin/bwrap',version:'1.0.30',identityRevision:'1',readOnlyRuntimeRoots:[dirname(dirname(node))]},transport:(request,host)=>Effect.gen(function*(){
   editedWorkspace=host.cwd;
   admittedTask=typeof request.artifacts[0]?.content==='string'?request.artifacts[0].content:undefined;
   if(scenario==='late-write')yield* Effect.addFinalizer(()=>Effect.promise(async()=>{const fs=await import('node:fs/promises');await fs.writeFile(join(host.cwd,'src/value.txt'),'late\n');}));
   const gate=yield* Deferred.make<void>();
   const identity:ProviderIdentityV1={kind:'native',provider:'xai',profileId:'grok-4.6',model:'grok-4.6',transportId:'grok-acp',credentialProfileRef:request.credentialProfileRef,protocolVersion:'1',sessionId:'fixture-native'};
   const pending:ToolRequestV1={callId:'edit-one',name:'edit',arguments:{path:'src/value.txt'},authorizationBinding:host.hostPermissionPortRef!};
   const denied=yield* host.permissions!.authorize(identity,{...pending,arguments:{path:'.git/config'}},request.toolPolicy).pipe(Effect.either);assert.equal(denied._tag,'Left');
   const authorization=yield* host.permissions!.authorize(identity,pending,request.toolPolicy);
   const toolEvent:ProviderEventV1={schemaVersion:1,effectId:request.effectId,providerIdentity:identity,payload:{type:'tool-request',request:{...pending,authorizationBinding:authorization}}};
   const complete=Effect.scoped(Effect.gen(function*(){
    yield* Deferred.await(gate);
    const code=`require('node:fs').writeFileSync('src/value.txt','1\\n');${scenario==='ignored-extra'?"require('node:fs').writeFileSync('src/.gitignore','*\\n');require('node:fs').writeFileSync('src/hidden.txt','extra');":''}process.stdout.write('{}\\n');`;
    const child=yield* host.process!.open({cmd:[node,'-e',code],cwd:host.cwd,environment:host.environment,deadline:request.limits.deadline,maxOutputBytes:65536,closeInput:true});
    yield* Stream.runDrain(child.events);
    return {schemaVersion:1,effectId:request.effectId,providerIdentity:identity,payload:{type:'completed',result:{value:{tag:'boolean',value:true},json:true,schemaId:request.outputSchema.id,schemaSha256:sha256Hex(canonicalize(request.outputSchema.content)),byteLength:4}}} as ProviderEventV1;
   }));
   const transport:ProviderTransport={id:'grok-acp',version:'1.0.30',probe:()=>Effect.fail({_tag:'ProbeUnknown',retryClass:'never',message:'unused'}),start:()=>Effect.succeed(Stream.concat(Stream.succeed(toolEvent),Stream.fromEffect(complete))),sendToolResult:(observed,result)=>host.permissions!.submit(observed,result,()=>Effect.gen(function*(){
    const retained=yield* Effect.promise(async()=>{const providers=join(root,'state/providers');const directories=await readdir(providers);return readFile(join(providers,directories.find(name=>name.startsWith('qualification-'))!,'runs/qualification/events.ndjson'),'utf8');});
    assert.match(retained,/provider.qualification.permission.v1/);assert.ok(retained.includes(result.receiptRef));durableBeforeAck=true;yield* Deferred.succeed(gate,undefined);
    let forgedSent=false;
    const forged=yield* host.permissions!.submit(observed,{...result,receiptRef:'unretained'},()=>Effect.sync(()=>{forgedSent=true;})).pipe(Effect.either);
    assert.equal(forged._tag,'Left');assert.equal(forgedSent,false);
   })),cancel:()=>Effect.succeed({requested:true,acknowledged:true,localCleanup:'complete',remoteOutcome:'cancelled'}),observe:()=>Effect.succeed({status:'unsupported',providerIdentity:identity,reason:'unused'}),resume:()=>Effect.fail({_tag:'ResumeUnavailable',retryClass:'never',message:'unused'})};
   if(scenario==='no-tools')return {...transport,start:()=>Effect.succeed(Stream.succeed({schemaVersion:1,effectId:request.effectId,providerIdentity:identity,payload:{type:'completed',result:{value:{tag:'boolean',value:true},json:true,schemaId:request.outputSchema.id,schemaSha256:sha256Hex(canonicalize(request.outputSchema.content)),byteLength:4}}} as ProviderEventV1))};
   return scenario === 'auth-failure' ? {...transport, start:()=>Effect.fail({_tag:'AuthenticationRequired' as const,retryClass:'never' as const,message:'Selected account rejected'})} : transport;
  })}));
  assert.match(admittedTask??'',/Do not list directories or read files before the edit/);
  if(scenario === 'auth-failure') {
   assert.equal(durableBeforeAck,false);assert.equal(report.failure?._tag,'AuthenticationRequired');assert.equal(report.failure?.message,'Selected account rejected');
  } else if(scenario==='no-tools') {
   assert.equal(durableBeforeAck,false);
   assert.equal(report.assertions.find(row=>row.capability==='tools')?.passed,false);
   assert.equal(report.assertions.find(row=>row.capability==='tools')?.reason,'No durable host permission result was acknowledged.');
  } else assert.equal(durableBeforeAck,true);
  assert.equal(report.outcome,scenario==='exact'?'success':'failed',JSON.stringify(report));assert.ok(report.evidence.every(row=>row.state==='fixture-tested'));
  if(scenario==='exact')assert.equal(report.evidence.length,6);
  else assert.equal(report.assertions.find(row=>row.capability==='codingTask')?.passed,false);
  await assert.rejects(readFile(join(editedWorkspace,'src/value.txt')),{code:'ENOENT'});
  const providers=join(root,'state/providers'),directory=(await readdir(providers)).find(name=>name.startsWith('qualification-'))!;
  const history=await readFile(join(providers,directory,'runs/qualification/events.ndjson'),'utf8');assert.match(history,/provider.qualification.report.v1/);assert.ok(history.includes(`"workspaceIntact":${scenario!=='ignored-extra'}`));assert.doesNotMatch(history,/execution\.authority|action\.reserved|pel\.run\.admitted/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('product native coding qualification resolves only the selected credential before allocating evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foredi-qualification-product-'));
 try{
  const input=selection(),services=makeLiveProviderCliServices({stateRoot:join(root,'state'),worktreeRoot:root,userHome:root,environment:{}});
  const result=await Effect.runPromise(services.qualify({...input,credentialProfileRef:'env:XAI_API_KEY',binding:{kind:'qualification',evidenceRef:'product:unavailable',expiresAt:Date.now()+60000}}).pipe(Effect.either));
  assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left._tag,'AuthenticationRequired');assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('native coding qualification rejects unsupported or fixture/product substitutions before filesystem changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foredi-qualification-invalid-'));
 try{
  for(const input of [{...selection(),transportId:'claude-code' as const},{...selection(),binding:{kind:'qualification' as const,evidenceRef:'product',expiresAt:Date.now()+10000}},{...selection(),controls:{...selection().controls,toolChoice:'none' as const}}]){
   const result=await Effect.runPromise(runNativeCodingQualification(input,{stateRoot:join(root,'state'),worktreeRoot:root,userHome:root,environment:{}},undefined).pipe(Effect.either));assert.equal(result._tag,'Left');
  }
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
