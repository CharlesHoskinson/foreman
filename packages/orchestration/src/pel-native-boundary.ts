/** Linux mount and process isolation for existing native provider adapters. */
import {lstat,realpath,stat,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {dirname,isAbsolute,join,resolve,sep,basename} from 'node:path';
import {Effect} from 'effect';
import type {Scope} from 'effect';
import {createNativeProcessPort,type NativeProcessPort,type ProviderFailure,type HostPermissionPort,type ProviderRequestV1} from '@foreman/providers';
import type {PelExecutionNativeBoundaryV1,PelExecutionTransportOptions} from './pel-execution-provider-live.js';
import type {PelNativeScopeV1} from './pel-native-scope.js';
import {ProcessExec,liveProcessExec} from './queue-services.js';
const denied=():ProviderFailure=>({_tag:'UnsupportedCapability',retryClass:'never',message:'The native execution boundary is unavailable or differs from its admitted filesystem, process, or permission scope.'});
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
const supportedCoding=['grok-acp','codex-app-server'];
const supportedNone=['claude-code'];
const secretKeys:Readonly<Record<string,readonly string[]>>={'grok-acp':['XAI_API_KEY'],'codex-app-server':['OPENAI_API_KEY'],'claude-code':['ANTHROPIC_API_KEY']};
export interface PelNativeBoundaryOptions {
 readonly bwrapPath:string;
 readonly executableByTransport:Readonly<Record<string,string>>;
 readonly readOnlyRuntimeRoots:readonly string[];
 readonly runtimeExecutablePaths?:readonly string[];
 readonly environmentKeys:readonly string[];
 readonly permissionGrantIds:readonly string[];
 readonly hostPermissionPortRef:string;
 readonly permissions:HostPermissionPort;
 readonly identityRevisionByTransport:Readonly<Record<string,string>>;
 readonly transportVersionByTransport:Readonly<Record<string,string>>;
 /** Qualification probes the actual write mounts before any provider launch. */
 readonly probeWriteBoundary?:boolean;
}
const attempt=<A>(f:()=>Promise<A>)=>Effect.tryPromise({try:f,catch:denied});
function noToolArguments(request:ProviderRequestV1,cmd:readonly string[]):boolean {
 if(request.toolPolicy.mode!=='none')return true;
 const tools=cmd.flatMap((arg,index)=>arg==='--tools'?[index]:[]);
 if(tools.length!==1||cmd[tools[0]!+1]!=='')return false;
 return request.transportId==='claude-code'&&cmd.includes('--restricted')&&cmd.includes('--safe-mode')&&cmd.includes('--strict-mcp-config')&&cmd[cmd.indexOf('--mcp-config')+1]==='{"mcpServers":{}}'&&cmd[cmd.indexOf('--setting-sources')+1]==='';
}
/** Configuration comes from registered host state. Provider or Pel data cannot construct it. */
export function makePelNativeBoundary(options:PelNativeBoundaryOptions):(request:ProviderRequestV1,context:PelNativeScopeV1)=>Effect.Effect<PelExecutionNativeBoundaryV1,ProviderFailure,Scope.Scope>{
 return (request,context)=>Effect.gen(function*(){
  const coding=request.toolPolicy.mode==='native-coding';
  if(process.platform!=='linux'||!process.geteuid||!(coding?supportedCoding:supportedNone).includes(request.transportId)||options.transportVersionByTransport[request.transportId]!==request.transportVersion||!options.identityRevisionByTransport[request.transportId]||!Number.isFinite(request.limits.deadline)||request.limits.deadline<=Date.now())return yield* Effect.fail(denied());
  if(coding&&(request.toolPolicy.mode!=='native-coding'||request.toolPolicy.workspaceGrantId!==context.workspace.grantId||request.toolPolicy.hostPermissionPortRef!==options.hostPermissionPortRef||!request.toolPolicy.permissionGrantIds.length||request.toolPolicy.permissionGrantIds.some(id=>!options.permissionGrantIds.includes(id))||!context.workspace.writablePaths.length))return yield* Effect.fail(denied());
  const admitted=yield* attempt(async()=>{
   const bwrap=await realpath(options.bwrapPath),binary=await lstat(bwrap);if(!binary.isFile()||binary.uid!==0||(binary.mode&0o022)!==0||(binary.mode&0o111)===0)throw denied();
   const selected=options.executableByTransport[request.transportId];if(!selected||!isAbsolute(selected))throw denied();const executable=await realpath(selected),entry=await stat(executable);if(!entry.isFile()||(entry.mode&0o022)!==0||(entry.mode&0o111)===0)throw denied();
   const root=context.workspace.canonicalRoot,info=await stat(root);if(await realpath(root)!==root||`${info.dev}:${info.ino}`!==context.workspace.directoryIdentity)throw denied();
   const runtimeRoots=[...new Set(await Promise.all(['/usr',...options.readOnlyRuntimeRoots].map(async path=>{const actual=await realpath(path),info=await stat(actual);if(!isAbsolute(path)||actual!==path||!info.isDirectory()||path==='/'||within(path,context.binding.stateRoot)||within(path,context.binding.repository.gitCommonDir)||(info.mode&0o022)!==0)throw denied();return actual;})))];
   if(!runtimeRoots.some(path=>within(path,executable)))throw denied();
   const writeRoots:string[]=[];
   if(coding)for(const path of context.workspace.writablePaths){if(path.includes('\0')||path.split(/[\\/]/).includes('..'))throw denied();const full=resolve(root,path),actual=await realpath(full),entry=await lstat(full);if(actual!==full||!within(root,full)||!entry.isDirectory()||within(join(root,'.git'),full))throw denied();writeRoots.push(full);}
   const gitPaths=[join(root,'.git'),context.binding.repository.gitCommonDir];
   for(const path of gitPaths){const info=await lstat(path);if(info.isSymbolicLink())throw denied();}
   const identities=await Promise.all([...new Set([bwrap,executable,root,...runtimeRoots,...writeRoots,...gitPaths])].map(async path=>{const info=await lstat(path);return {path,dev:info.dev,ino:info.ino,mode:info.mode,uid:info.uid,file:info.isFile(),size:info.size,mtime:info.mtimeMs,ctime:info.ctimeMs};}));
   return {bwrap,executable,root,runtimeRoots,writeRoots:[...new Set(writeRoots)].sort(),gitPaths:[...new Set(gitPaths)],identities};
  });
  const flags=['--unshare-user','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--proc','/proc','--dev','/dev','--dir','/tmp','--tmpfs','/tmp/foreman-native-home','--tmpfs','/tmp/foreman-native-tmp'];
  for(const path of admitted.runtimeRoots)flags.push('--ro-bind',path,path);
  for(const [alias,target] of [['/bin','usr/bin'],['/sbin','usr/sbin'],['/lib','usr/lib'],['/lib64','usr/lib64']] as const)flags.push('--symlink',target,alias);
  // Public certificate and resolver configuration do not expose the host home.
  for(const path of ['/etc/ssl/certs','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf']){const actual=yield* attempt(()=>realpath(path));flags.push('--ro-bind',actual,path);}
  flags.push('--ro-bind',admitted.root,admitted.root);
  for(const path of admitted.writeRoots)flags.push('--bind',path,path);
  for(const path of admitted.gitPaths)flags.push('--ro-bind',path,path);
  flags.push('--remount-ro','/','--chdir',admitted.root,'--');
  const runtimeDirectories=yield* attempt(async()=>Promise.all((options.runtimeExecutablePaths??[]).map(async path=>{const canonical=await realpath(path),entry=await lstat(canonical);if(!entry.isFile()||canonical!==path||!admitted.runtimeRoots.some(root=>within(root,path)))throw denied();return dirname(path);})));
  const environment={PATH:[dirname(admitted.executable),...runtimeDirectories,'/usr/bin','/bin'].join(':'),LANG:'C.UTF-8',HOME:'/tmp/foreman-native-home',TMPDIR:'/tmp/foreman-native-tmp'};
  // Run the actual namespace/mount operation before reporting enforcement.
  yield* Effect.gen(function*(){const proc=yield* ProcessExec;const result=yield* proc.runCaptured({command:admitted.bwrap,args:[...flags,'/usr/bin/true'],env:environment,maxOutputBytes:16384,timeoutMs:Math.min(3000,request.limits.deadline-Date.now())});if(result.exitCode!==0)return yield* Effect.fail(denied());}).pipe(Effect.provide(liveProcessExec),Effect.mapError(denied));
  if(options.probeWriteBoundary){
   if(!coding||admitted.writeRoots.length!==1)return yield* Effect.fail(denied());
   const probe=`.foreman-qualification-${randomBytes(16).toString('hex')}`;
   const attempts=[{path:join(admitted.root,probe),allowed:false},{path:join(context.binding.repository.gitCommonDir,probe),allowed:false},{path:join(admitted.writeRoots[0]!,probe),allowed:true}];
   yield* Effect.gen(function*(){const proc=yield* ProcessExec;
    for(const attempt of attempts){const result=yield* proc.runCaptured({command:admitted.bwrap,args:[...flags,'/usr/bin/touch','--',attempt.path],env:environment,maxOutputBytes:4096,timeoutMs:Math.min(3000,request.limits.deadline-Date.now())});
     if((result.exitCode===0)!==attempt.allowed)return yield* Effect.fail(denied());
    }
   }).pipe(Effect.provide(liveProcessExec),Effect.mapError(denied),Effect.ensuring(Effect.promise(async()=>{for(const attempt of attempts)await unlink(attempt.path).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});})));
  }
  const native=createNativeProcessPort();
  const nativePort:NativeProcessPort={open:launch=>Effect.gen(function*(){
   if(launch.cwd!==admitted.root||!launch.cmd.length||![admitted.executable,options.executableByTransport[request.transportId],basename(options.executableByTransport[request.transportId]!),({'grok-acp':'grok','codex-app-server':'codex','claude-code':'claude'} as Record<string,string>)[request.transportId]!].includes(launch.cmd[0]!)||launch.deadline>request.limits.deadline||launch.maxOutputBytes>Math.min(64*1024*1024,request.limits.maxOutputBytes+1024*1024)||!noToolArguments(request,launch.cmd))return yield* Effect.fail(denied());
   yield* attempt(async()=>{for(const prior of admitted.identities){const current=await lstat(prior.path);if(await realpath(prior.path)!==prior.path||current.isSymbolicLink()||current.dev!==prior.dev||current.ino!==prior.ino||current.mode!==prior.mode||current.uid!==prior.uid||prior.file&&(current.size!==prior.size||current.mtimeMs!==prior.mtime||current.ctimeMs!==prior.ctime))throw denied();}});
   const selectedEnvironment:Record<string,string>={...environment};
   for(const key of options.environmentKeys)if(secretKeys[request.transportId]?.includes(key)&&launch.environment[key]!==undefined)selectedEnvironment[key]=launch.environment[key]!;
   for(const key of ['GROK_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR'])if(launch.environment[key]&&launch.environment[key]!==environment.HOME)return yield* Effect.fail(denied());
   return yield* native.open({...launch,cmd:[admitted.bwrap,...flags,admitted.executable,...launch.cmd.slice(1)],environment:selectedEnvironment});
  })};
  const boundary:PelExecutionNativeBoundaryV1={host:{cwd:admitted.root,environment,process:nativePort,workspaceGrantId:context.workspace.grantId,permissionGrantIds:options.permissionGrantIds,hostPermissionPortRef:options.hostPermissionPortRef,permissions:options.permissions,toolPolicyNoneEnforced:!coding,workspaceBoundaryEnforced:true,permissionBoundaryEnforced:coding},identityRevision:options.identityRevisionByTransport[request.transportId]!};
  return boundary;
 });
}
