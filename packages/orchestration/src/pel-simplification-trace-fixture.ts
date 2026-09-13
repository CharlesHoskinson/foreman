/** Unshipped measurement fixture. Existing owner and native serializer; no provider subprocess. */
import {Effect,Queue,Stream,Redacted}from'effect';
import {canonicalize,sha256Hex}from'@foreman/core';
import {createAuthoringSnapshotV1}from'@foreman/pel';
import {listProviderCells,type ProviderRequestV1,type ProviderFailure}from'@foreman/providers';
import {createGrokAcpTransport}from'../../providers/src/transports/grok-acp.js';
import type {NativeProcessPort}from'../../providers/src/transports/native-process.js';
import {createDefaultAuthoringSnapshotV1}from'./pel-host-descriptors.js';
import {makePelDeliveryFixtureServices,pelDeliveryFixtureSettingsV1}from'./pel-cli-delivery-fixture.js';
import {makeForemanCli}from'./pel-authoring-cli.js';
import {authoringFailure,type AuthoringFailure}from'./pel-authoring-contract.js';
import {pelFailure}from'./pel-journal.js';
import type {HostContextV1}from'./pel-run-contract.js';
import type {MetricFile}from'./pel-simplification.js';
import {makeStandardStartTrace,standardStartCommands,type PelStandardStartTraceV1}from'./pel-simplification-trace.js';

function captureGrokInstructions(request:ProviderRequestV1,context:HostContextV1,now:number){return Effect.scoped(Effect.gen(function*(){
 const captured:{channel:'grok-system-override'|'grok-output-schema'|'grok-session-prompt';text:string}[]=[];
 const refusal:ProviderFailure={_tag:'UnsupportedCapability',retryClass:'never',message:'Measurement fixture has no permission tools.'};
 const process:NativeProcessPort={open:launch=>Effect.gen(function*(){
  for(const[flag,channel]of [['--system-prompt-override','grok-system-override'],['--json-schema','grok-output-schema']]as const){const i=launch.cmd.indexOf(flag);if(i<0||!launch.cmd[i+1])return yield* Effect.fail(refusal);captured.push({channel,text:launch.cmd[i+1]!});}
  const queue=yield* Queue.unbounded<Readonly<Record<string,unknown>>>();yield* Effect.addFinalizer(()=>Queue.shutdown(queue));
  return {events:Stream.fromQueue(queue),close:()=>Effect.void,send:(message:Readonly<Record<string,unknown>>)=>Effect.gen(function*(){
   let result:unknown={};
   if(message.method==='initialize')result={protocolVersion:1,agentInfo:{name:'grok',version:'1.0.30'},authMethods:[{id:'xai.api_key'}]};
   else if(message.method==='session/new')result={sessionId:'startup-fixture',configOptions:[{id:'model',category:'model',type:'select',currentValue:'grok-4.6'}]};
   else if(message.method==='session/prompt'){
    const params=message.params as {prompt?:readonly {type:string;text:string}[]};if(params.prompt?.length!==1||params.prompt[0]?.type!=='text')return yield* Effect.fail(refusal);
    captured.push({channel:'grok-session-prompt',text:params.prompt[0].text});
    // The measured boundary is the sent prompt. There is no remote completion.
    return yield* Effect.fail({_tag:'OutcomeUnknown',retryClass:'never',message:'Fixture stops at first transmitted prompt.'} as ProviderFailure);
   }
   if(message.id!==undefined)yield* Queue.offer(queue,{jsonrpc:'2.0',id:message.id,result});
  })};
 })};
 if(request.profileId!=='grok-4.6'||request.transportId!=='grok-acp'||request.toolPolicy.mode!=='native-coding')return yield* Effect.fail(refusal);
 const policy=request.toolPolicy,transport=createGrokAcpTransport({version:request.transportVersion,installedVersion:'1.0.30',now:()=>now,schemaRegistry:context.checked.snapshot.registry.dataSchemas,credentials:{resolve:()=>Effect.succeed({environment:{XAI_API_KEY:Redacted.make('measurement-fixture-only')}})},process,host:{cwd:context.workspace.canonicalRoot,environment:{PATH:'/usr/bin:/bin'},workspaceGrantId:policy.workspaceGrantId,hostPermissionPortRef:policy.hostPermissionPortRef,permissionGrantIds:policy.permissionGrantIds,toolPolicyNoneEnforced:false,workspaceBoundaryEnforced:true,permissionBoundaryEnforced:true,permissions:{authorize:()=>Effect.fail(refusal),submit:()=>Effect.fail(refusal)}}});
 const outcome=yield* Effect.either(Effect.flatMap(transport.start(request),stream=>Stream.runDrain(stream)));
 if(captured.length!==3)return yield* Effect.fail({...refusal,message:outcome._tag==='Left'?JSON.stringify(outcome.left):'Missing captured instructions.'});return captured;
}));}
export function collectStandardStartFixture(input:{readonly candidateCommit:string;readonly candidateFiles:readonly MetricFile[];readonly temporaryRoot:string}):Effect.Effect<PelStandardStartTraceV1,AuthoringFailure>{return Effect.gen(function*(){
 const source=input.candidateFiles.find(f=>f.path==='examples/pel/implement-verify-review.pel');if(!source)return yield* Effect.fail(authoringFailure('PEL_INPUT','The candidate standard example is absent.'));
 const now=Date.now(),base=createDefaultAuthoringSnapshotV1(),role=(id:string,transport:string)=>{const p=base.providerProfiles.find(p=>p.profileId===id&&p.transportId===transport)!;return {profileId:id,transportId:transport,credentialProfileRef:'account:test',controls:p.applicationDefaults};},snapshot=createAuthoringSnapshotV1({...base,roleBindings:{'role:implementer':role('grok-4.6','grok-acp'),'role:reviewer':role('gpt-5.6-sol','codex-app-server')}});if(!snapshot.ok)return yield* Effect.fail(authoringFailure('PEL_SCHEMA','The fixture snapshot is invalid.'));
 const manifest=Buffer.from(canonicalize({schemaVersion:1,evidenceKind:'test-fixture',fixtureId:'m6-startup-instructions',candidateCommit:input.candidateCommit})),settings=Buffer.from(canonicalize(pelDeliveryFixtureSettingsV1));
 let stdout='',stderr='',captureError='',captured:Awaited<Effect.Effect.Success<ReturnType<typeof captureGrokInstructions>>>|undefined,boundary:{stdout:string;stderr:string}|undefined;
 const lifecycle=yield* makePelDeliveryFixtureServices({schemaVersion:1,evidenceKind:'test-fixture',fixtureId:'m6-startup-instructions',temporaryRoot:input.temporaryRoot,stateRoot:input.temporaryRoot+'/state',now,scenario:'approved',roles:'grok-sol',failurePoint:'none'},snapshot.value,sha256Hex(manifest),manifest,settings,undefined,{observeProviderStart:(request,context)=>Effect.gen(function*(){if(captured)return;captured=yield* captureGrokInstructions(request,context,now).pipe(Effect.mapError(error=>{captureError=error.message;return pelFailure('binding-mismatch','Native instruction capture failed.');}));boundary={stdout,stderr};})});
 const snapshotBytes=Buffer.from(canonicalize(snapshot.value));
 const cli=makeForemanCli({context:{defaultSnapshotPath:'snapshot.json'},input:{read:(path,max)=>{const bytes=path==='snapshot.json'?snapshotBytes:path==='implement-verify-review.pel'?source.bytes:undefined;return bytes&&bytes.byteLength<=max?Effect.succeed(bytes):Effect.fail(authoringFailure('PEL_INPUT','Measurement fixture input is unavailable.'));}},output:{stdout:text=>Effect.sync(()=>{stdout+=text;}),stderr:text=>Effect.sync(()=>{stderr+=text;})},lifecycle,providers:{now:()=>now,list:()=>Effect.succeed(listProviderCells([],now)),qualify:()=>Effect.fail({_tag:'UnsupportedCapability',retryClass:'never',message:'No qualification in measurement fixture.'})},adoption:{version:()=>Effect.succeed({releaseName:'Return of the ForeDi',version:'test-fixture',buildId:input.candidateCommit}),rollback:()=>Effect.die('No rollback in startup trace.'),support:()=>Effect.die('No support export in startup trace.')}});
 const commands:{argv:readonly string[];stdout:string;stderr:string;exitCode:number|null}[]=[];
 for(const[index,argv]of standardStartCommands.entries()){stdout='';stderr='';const result=yield* cli.run(argv);if(index===4){if(!boundary||!captured)return yield* Effect.fail(authoringFailure('PEL_INPUT',`Standard workflow did not reach its first provider prompt: ${captureError} ${stdout} ${stderr}`));commands.push({argv,...boundary,exitCode:null});}else{if(result.exitCode!==0)return yield* Effect.fail(authoringFailure('PEL_INPUT',`Standard startup command ${index} failed: ${stderr}`));commands.push({argv,stdout,stderr,exitCode:result.exitCode});}}
 return makeStandardStartTrace({candidateCommit:input.candidateCommit,candidateFiles:input.candidateFiles,evidenceKind:'test-fixture',commands,provider:{profileId:'grok-4.6',transportId:'grok-acp',protocolVersion:'1'},instructions:captured!});
});}
/** Generate fixture evidence only from the exact clean source candidate being executed. */
export function collectCandidateStandardStartTrace(input:{readonly repositoryRoot:string;readonly candidateCommit:string}){return Effect.scoped(Effect.gen(function*(){
 const {ProcessExec,liveProcessExec}=yield* Effect.promise(()=>import('./queue-services.js'));
 const {readMetricRevision}=yield* Effect.promise(()=>import('./pel-simplification-live.js'));
 const {mkdtemp,mkdir,rm,realpath}=yield* Effect.promise(()=>import('node:fs/promises')),{join}=yield* Effect.promise(()=>import('node:path')),{tmpdir}=yield* Effect.promise(()=>import('node:os'));
 const clean=()=>Effect.gen(function*(){const port=yield* ProcessExec;const call=(args:readonly string[])=>port.runCaptured({command:'git',args:['--no-pager',...args],cwd:input.repositoryRoot,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},maxOutputBytes:1048576,timeoutMs:10000}).pipe(Effect.mapError(()=>authoringFailure('PEL_INPUT','The candidate identity cannot be inspected.')));const head=yield* call(['rev-parse','HEAD']),status=yield* call(['status','--porcelain','--untracked-files=all']);if(head.exitCode!==0||head.stdout.trim()!==input.candidateCommit||status.exitCode!==0||status.stdout.length!==0)return yield* Effect.fail(authoringFailure('PEL_INPUT','Startup collection requires the exact clean candidate checkout.'));}).pipe(Effect.provide(liveProcessExec));
 const {fileURLToPath}=yield* Effect.promise(()=>import('node:url'));const moduleRoot=yield* Effect.tryPromise({try:()=>realpath(fileURLToPath(new URL('../../../',import.meta.url))),catch:()=>authoringFailure('PEL_INPUT','The collector source root is unavailable.')});if((yield* Effect.promise(()=>realpath(input.repositoryRoot)))!==moduleRoot)return yield* Effect.fail(authoringFailure('PEL_INPUT','The collector must execute from the selected candidate source root.'));
 yield* clean();const candidateFiles=yield* readMetricRevision(input.repositoryRoot,input.candidateCommit).pipe(Effect.mapError(error=>authoringFailure('PEL_INPUT',error.message)));
 const temporaryRoot=yield* Effect.acquireRelease(Effect.tryPromise({try:()=>mkdtemp(join(tmpdir(),'pel-startup-candidate-')),catch:()=>authoringFailure('PEL_INPUT','The temporary fixture directory is unavailable.')}),path=>Effect.promise(()=>rm(path,{recursive:true,force:true})));
 yield* Effect.tryPromise({try:()=>mkdir(join(temporaryRoot,'state')),catch:()=>authoringFailure('PEL_INPUT','The fixture state directory is unavailable.')});
 const trace=yield* collectStandardStartFixture({...input,candidateFiles,temporaryRoot});yield* clean();return trace;
}));}
