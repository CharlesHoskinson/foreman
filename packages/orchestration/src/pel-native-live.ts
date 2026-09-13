/** Metadata-only native installation discovery and the existing enforcing launch boundary. */
import {constants} from 'node:fs';
import {realpath,lstat,open,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect} from 'effect';
import type {ProviderFailure,HostPermissionPort} from '@foreman/providers';
import {canonicalize,sha256Hex} from '@foreman/core';
import {PathLookup,ProcessExec,livePathLookup,liveProcessExec} from './queue-services.js';
import type {LiveProviderContext} from './pel-provider-live.js';
import type {HostContextV1,PelHostEffectFailureV1} from './pel-run-contract.js';
import {makePelNativeBoundary} from './pel-native-boundary.js';
import type {PelExecutionTransportOptions} from './pel-execution-provider-live.js';
export const pelNativeSupportedModes={ 'grok-acp':['native-coding'], 'codex-app-server':['native-coding'], 'claude-code':['none'], 'gemini-cli':[] } as const;
export interface PelNativeDiscoveryPorts {
 readonly which:typeof PathLookup.Service.which;
 readonly runCaptured:typeof ProcessExec.Service.runCaptured;
}
export interface PelInstalledNativeV1 {readonly executable:string;readonly version:string;readonly identityRevision:string;readonly readOnlyRuntimeRoots:readonly string[];readonly nodeExecutable:string;readonly bwrapPath:string;}
const names:Readonly<Record<string,string>>={'grok-acp':'grok','codex-app-server':'codex','claude-code':'claude'};
const unsupported=(message:string):ProviderFailure=>({_tag:'UnsupportedCapability',retryClass:'never',message});
const hostFailure=(failure:ProviderFailure):PelHostEffectFailureV1=>({code:'capability-denied',message:failure.message,cause:{providerFailure:{_tag:failure._tag,retryClass:failure.retryClass}}});
const fail=()=>unsupported('Install a supported native executable and Linux bubblewrap boundary, then refresh the exact provider preflight and qualification evidence. The current installation cannot enforce this request.');
const io=<A>(run:()=>Promise<A>)=>Effect.tryPromise({try:run,catch:fail});
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
async function prefix(path:string,size:number){const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await fd.stat();if(!info.isFile()||info.size<size||(info.mode&0o022)!==0)throw fail();const bytes=Buffer.alloc(size);const read=await fd.read(bytes,0,size,0);if(read.bytesRead!==size)throw fail();return bytes;}finally{await fd.close();}}
/** No credentials, providers, task reservations or run allocation are used during discovery. */
export function makeLivePelNativeServices(live:LiveProviderContext,ports?:PelNativeDiscoveryPorts){
 const which=(name:string)=>ports?ports.which(name):Effect.flatMap(PathLookup,p=>p.which(name)).pipe(Effect.provide(livePathLookup));
 const captured:typeof ProcessExec.Service.runCaptured=request=>ports?ports.runCaptured(request):Effect.flatMap(ProcessExec,p=>p.runCaptured(request)).pipe(Effect.provide(liveProcessExec));
 const installed=(transportId:string):Effect.Effect<PelInstalledNativeV1,ProviderFailure>=>Effect.scoped(Effect.gen(function*(){
  const name=names[transportId];if(process.platform!=='linux'||!name)return yield* Effect.fail(fail());
  const selected=yield* which(name),selectedNode=yield* which('node'),selectedBwrap=yield* which('bwrap');if(!selected||!selectedNode||!selectedBwrap)return yield* Effect.fail(fail());
  const facts=yield* io(async()=>{
   if(![selected,selectedNode,selectedBwrap].every(isAbsolute))throw fail();
   const executable=await realpath(selected),nodeExecutable=await realpath(selectedNode),bwrapPath=await realpath(selectedBwrap);
   for(const path of [executable,nodeExecutable,bwrapPath]){const info=await lstat(path);if(!info.isFile()||(info.mode&0o111)===0||(info.mode&0o022)!==0)throw fail();}
   if((await lstat(bwrapPath)).uid!==0)throw fail();
   const header=await prefix(executable,4);let packageRoot:string;
   if(header.equals(Buffer.from([0x7f,0x45,0x4c,0x46])))packageRoot=dirname(executable);
   else if(transportId==='codex-app-server'&&executable.endsWith('/bin/codex.js')){
    packageRoot=dirname(dirname(executable));const path=join(packageRoot,'package.json'),info=await lstat(path);if(info.size>65536||!info.isFile()||info.isSymbolicLink())throw fail();
    const packageJson=JSON.parse((await prefix(path,info.size)).toString('utf8')) as {name?:unknown};if(packageJson.name!=='@openai/codex')throw fail();
   }else throw fail();
   const nodeRoot=dirname(dirname(nodeExecutable)),readOnlyRuntimeRoots=[...new Set([packageRoot,nodeRoot])];
   for(const path of readOnlyRuntimeRoots){const info=await lstat(path);if(await realpath(path)!==path||!info.isDirectory()||path==='/'||path===resolve(live.userHome)||within(path,resolve(live.stateRoot))||(info.mode&0o022)!==0)throw fail();}
   return {executable,nodeExecutable,bwrapPath,readOnlyRuntimeRoots};
  });
  const directory=yield* Effect.acquireRelease(io(()=>mkdtemp(join(tmpdir(),'foreman-native-version-'))),path=>Effect.promise(()=>rm(path,{recursive:true,force:true})).pipe(Effect.orDie));
  const result=yield* captured({command:facts.executable,args:['--version'],cwd:directory,env:{PATH:[dirname(facts.nodeExecutable),'/usr/bin','/bin'].join(':'),HOME:directory,TMPDIR:directory,LANG:'C.UTF-8'},maxOutputBytes:4096,timeoutMs:10000}).pipe(Effect.mapError(fail));
  const text=result.stdout.trim(),version=/\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/u.exec(text)?.[1];if(result.exitCode!==0||!version||Buffer.byteLength(text)>4096)return yield* Effect.fail(fail());
  return {...facts,version:transportId==='codex-app-server'?`${version}/v2`:version,identityRevision:transportId==='grok-acp'?'1':transportId==='codex-app-server'?'v2':version};
 }));
 const nativePolicy=(context:HostContextV1)=>Effect.gen(function*(){
  if(context.binding.stateRoot!==live.stateRoot||!context.binding.authoritySha256||!context.workspace.grantId||!context.workspace.writablePaths.length)return yield* Effect.fail(hostFailure(fail()));
  const digest=sha256Hex(canonicalize({authority:context.binding.authoritySha256,workspaceGrantId:context.workspace.grantId,workspaceIdentity:context.workspace.directoryIdentity,writablePaths:context.workspace.writablePaths}));
  return {permissionGrantIds:[`pel-native-workspace-${digest}`],hostPermissionPortRef:`pel-native-host-${digest}`};
 });
 const transportVersion=(transportId:string,_context:HostContextV1)=>['xai-responses','anthropic-messages','openai-responses','google-interactions'].includes(transportId)?Effect.succeed('1'):installed(transportId).pipe(Effect.map(x=>x.version),Effect.mapError(hostFailure));
 const permissions:HostPermissionPort={authorize:()=>Effect.fail(unsupported('Native permission decisions require the original request-scoped durable host port.')),submit:()=>Effect.fail(unsupported('Native permission submission requires its original durable tool result.'))};
 const boundary:NonNullable<PelExecutionTransportOptions['nativeBoundary']>=(request,context)=>Effect.gen(function*(){
  const modes:readonly string[]=(pelNativeSupportedModes as Readonly<Record<string,readonly string[]>>)[request.transportId]??[];if(!modes.includes(request.toolPolicy.mode))return yield* Effect.fail(unsupported('This installed native adapter does not support an enforced boundary for the requested tool policy.'));
  const installation=yield* installed(request.transportId),policy=yield* nativePolicy(context).pipe(Effect.mapError(fail));
  if(installation.version!==request.transportVersion)return yield* Effect.fail(unsupported('The installed native version differs from the original admitted request. Refresh its qualification before a new run.'));
  return yield* makePelNativeBoundary({bwrapPath:installation.bwrapPath,executableByTransport:{[request.transportId]:installation.executable},readOnlyRuntimeRoots:installation.readOnlyRuntimeRoots,runtimeExecutablePaths:[installation.nodeExecutable],environmentKeys:['XAI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'],permissionGrantIds:policy.permissionGrantIds,hostPermissionPortRef:policy.hostPermissionPortRef,permissions,identityRevisionByTransport:{[request.transportId]:installation.identityRevision},transportVersionByTransport:{[request.transportId]:installation.version}})(request,context);
 });
 return {installed,transportVersion,nativePolicy,boundary,supportedModes:pelNativeSupportedModes};
}
