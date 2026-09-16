import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,realpathSync,renameSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect,Stream,Redacted} from 'effect';
import type {ProviderRequestV1,HostPermissionPort} from '@foreman/providers';
import type {HostContextV1} from './pel-run-contract.js';
import {makePelNativeBoundary} from './pel-native-boundary.js';
const permissions:HostPermissionPort={authorize:()=>Effect.fail({_tag:'UnsupportedCapability',retryClass:'never',message:'No extra tool authority.'}),submit:()=>Effect.fail({_tag:'UnsupportedCapability',retryClass:'never',message:'No extra tool authority.'})};
function fixture(){const root=mkdtempSync(join(tmpdir(),'pel-native-boundary-')),workspace=join(root,'workspace'),git=join(workspace,'.git'),outside=join(root,'outside');mkdirSync(workspace);mkdirSync(join(workspace,'src'));mkdirSync(git);writeFileSync(join(git,'config'),'protected');writeFileSync(outside,'protected');const info=statSync(workspace);const context={workspace:{grantId:'workspace-grant',canonicalRoot:workspace,directoryIdentity:`${info.dev}:${info.ino}`,writablePaths:['src']},binding:{stateRoot:join(root,'state'),repository:{gitCommonDir:git},limits:{deadline:Date.now()+20000}}} as unknown as HostContextV1;
 const request={transportId:'grok-acp',transportVersion:'fixture-v1',toolPolicy:{mode:'native-coding',workspaceGrantId:'workspace-grant',permissionGrantIds:['permission-grant'],hostPermissionPortRef:'permissions'},limits:{deadline:Date.now()+20000,maxOutputBytes:65536}} as unknown as ProviderRequestV1;
 const options={bwrapPath:'/usr/bin/bwrap',executableByTransport:{'grok-acp':process.execPath},readOnlyRuntimeRoots:[dirname(dirname(realpathSync(process.execPath)))],environmentKeys:['XAI_API_KEY'],permissionGrantIds:['permission-grant'],hostPermissionPortRef:'permissions',permissions,identityRevisionByTransport:{'grok-acp':'fixture-v1'},transportVersionByTransport:{'grok-acp':'fixture-v1'}};
 return {root,workspace,git,outside,context,request,options,close:()=>rmSync(root,{recursive:true,force:true})};}
test('native Grok snapshot is read-only and does not expose the host profile', async () => {
 const f=fixture();try {
  const rows=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
   const boundary=yield* makePelNativeBoundary(f.options)(f.request,f.context);
   const code=`const fs=require('node:fs');const p=process.env.GROK_HOME+'/auth.json';let denied=false;try{fs.writeFileSync(p,'overwrite')}catch{denied=true}process.stdout.write(JSON.stringify({selected:JSON.parse(fs.readFileSync(p,'utf8')).fixture==='access-only',denied,hostVisible:fs.existsSync(${JSON.stringify(f.outside)}),git:fs.readFileSync(${JSON.stringify(join(f.git,'config'))},'utf8')})+'\\n');`;
   const connection=yield* boundary.host.process!.open({cmd:['grok','-e',code],cwd:f.workspace,
    environment:{...boundary.host.environment,GROK_HOME:boundary.host.environment.HOME+'/.grok'},
    grokAuthJson:Redacted.make('{"fixture":"access-only"}'),deadline:f.request.limits.deadline,maxOutputBytes:65536,closeInput:true});
   return yield* Stream.runCollect(connection.events);
  })));
  assert.deepEqual({...rows[Symbol.iterator]().next().value},{selected:true,denied:true,hostVisible:false,git:'protected'});
 }finally{f.close();}
});
test('Grok coding receives a read-only host policy even without a login snapshot',async()=>{
 const f=fixture();try{
  const rows=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
   const boundary=yield* makePelNativeBoundary(f.options)(f.request,f.context);
   const code=`const fs=require('node:fs');const p=process.env.GROK_HOME+'/config.toml';const policy=fs.readFileSync(p,'utf8');let denied=false;try{fs.writeFileSync(p,'')}catch{denied=true}process.stdout.write(JSON.stringify({policy,denied})+'\\n');`;
   const connection=yield* boundary.host.process!.open({cmd:['grok','-e',code],cwd:f.workspace,environment:boundary.host.environment,deadline:f.request.limits.deadline,maxOutputBytes:65536,closeInput:true});
   return yield* Stream.runCollect(connection.events);
  })));
  const row=[...rows][0]!;
  assert.equal(row.denied,true);
  assert.equal(row.policy,'[permission]\nrules = [{ action = "ask", tool = "any" }]\n[ui]\nremember_tool_approvals = false\n');
 }finally{f.close();}
});
test('T-M5-001 native boundary uses real namespaces to limit writes and hide ambient credentials',async()=>{
 const f=fixture();try{const rows=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){const boundary=yield* makePelNativeBoundary(f.options)(f.request,f.context);assert.equal(boundary.host.workspaceBoundaryEnforced,true);assert.equal(boundary.host.permissionBoundaryEnforced,true);
  const code=`const fs=require('node:fs');let denied=0;for(const p of ${JSON.stringify([f.outside,join(f.git,'config')])})try{fs.writeFileSync(p,'escaped')}catch{denied++}fs.writeFileSync(${JSON.stringify(join(f.workspace,'src/result.ts'))},'allowed');process.stdout.write(JSON.stringify({denied,ambient:process.env.AMBIENT_SECRET===undefined,selected:process.env.XAI_API_KEY==='fixture-key',home:process.env.HOME})+'\\n');`;
  const connection=yield* boundary.host.process!.open({cmd:['grok','-e',code],cwd:f.workspace,environment:{...boundary.host.environment,AMBIENT_SECRET:'must-not-cross',XAI_API_KEY:'fixture-key',NODE_OPTIONS:'--require /invalid'},deadline:f.request.limits.deadline,maxOutputBytes:65536,closeInput:true});return yield* Stream.runCollect(connection.events);
 })));const row=[...rows][0]!;assert.equal(row.denied,2);assert.equal(row.ambient,true);assert.equal(row.selected,true);assert.equal(readFileSync(f.outside,'utf8'),'protected');assert.equal(readFileSync(join(f.git,'config'),'utf8'),'protected');assert.equal(readFileSync(join(f.workspace,'src/result.ts'),'utf8'),'allowed');}finally{f.close();}
});
test('T-M5-002 native boundary refuses unsupported transports and unmatched grants before launch',async()=>{
 const f=fixture();try{for(const request of [{...f.request,toolPolicy:{mode:'none'}},{...f.request,transportId:'claude-code'},{...f.request,transportId:'gemini-cli'},{...f.request,toolPolicy:{...f.request.toolPolicy,workspaceGrantId:'other'}}]){const result=await Effect.runPromise(Effect.scoped(makePelNativeBoundary(f.options)(request as ProviderRequestV1,f.context)).pipe(Effect.either));assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left._tag,'UnsupportedCapability');}}finally{f.close();}
});
test('T-M5-002 native boundary never claims enforcement when the installed boundary is unavailable',async()=>{
 const f=fixture();try{const result=await Effect.runPromise(Effect.scoped(makePelNativeBoundary({...f.options,bwrapPath:'/missing/bwrap'})(f.request,f.context)).pipe(Effect.either));assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left._tag,'UnsupportedCapability');}finally{f.close();}
});

test('native launch rejects a writable grant replaced after its enforcement probe',async()=>{
 const f=fixture();try{const result=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
  const boundary=yield* makePelNativeBoundary(f.options)(f.request,f.context);
  renameSync(join(f.workspace,'src'),join(f.workspace,'original-src'));symlinkSync(f.root,join(f.workspace,'src'));
  return yield* boundary.host.process!.open({cmd:[process.execPath,'-e','process.exit(0)'],cwd:f.workspace,environment:boundary.host.environment,deadline:f.request.limits.deadline,maxOutputBytes:65536,closeInput:true});
 })).pipe(Effect.either));assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left._tag,'UnsupportedCapability');}finally{f.close();}
});
