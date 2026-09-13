/** Bounded permission decisions for processes already inside the admitted native boundary. */
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {Effect} from 'effect';
import {canonicalize,sha256Hex} from '@foreman/core';
import {resolveProfile,type HostPermissionPort,type ProviderRequestV1,type ProviderFailure,type ToolRequestV1} from '@foreman/providers';
import type {HostContextV1} from './pel-run-contract.js';
import {canonicalWorkspacePath} from './pel-resource-scope.js';
import type {PelToolExecutorV1} from './pel-provider-tools.js';
const denied=():ProviderFailure=>({_tag:'UnsupportedCapability',retryClass:'never',message:'The native permission request is outside its original effect, provider, writable paths or finite method set.'});
const inside=(root:string,path:string)=>path===root||path.startsWith(root+sep);
const paths=new Set(['path','file_path','filePath','cwd','workingDirectory','working_directory','sourcePath','destinationPath','old_path','new_path','grantRoot']);
const method=(transport:string,name:string)=>transport==='codex-app-server'?['item/fileChange/requestApproval','item/commandExecution/requestApproval'].includes(name):transport==='grok-acp'&&['read','edit','delete','move','search','execute'].includes(name);
const writes=(name:string)=>['edit','delete','move','item/fileChange/requestApproval'].includes(name);
/** Registration and the enforcing launcher supply this callback. Pel and provider data cannot install it. */
export function makePelNativePermissionAuthorizer(request:ProviderRequestV1,context:HostContextV1):HostPermissionPort['authorize'] {
 return (identity,tool,policy)=>Effect.gen(function*(){
  const profile=resolveProfile(request.profileId);
  if(request.effectId!==context.effect.effectId||request.toolPolicy.mode!=='native-coding'||policy.mode!=='native-coding'||canonicalize(policy)!==canonicalize(request.toolPolicy)||policy.workspaceGrantId!==context.workspace.grantId||!policy.permissionGrantIds.length||!policy.hostPermissionPortRef||request.limits.deadline<=Date.now()||request.limits.maxToolCalls<=0||identity.kind!=='native'||!profile.ok||identity.provider!==profile.value.provider||identity.profileId!==request.profileId||identity.transportId!==request.transportId||identity.credentialProfileRef!==request.credentialProfileRef||identity.model!==undefined&&identity.model!==profile.value.exactModel||!method(request.transportId,tool.name)||!tool.callId||tool.callId.length>1024)return yield* Effect.fail(denied());
  const encoded=yield* Effect.try({try:()=>canonicalize(tool.arguments),catch:denied});if(Buffer.byteLength(encoded)>65536)return yield* Effect.fail(denied());
  const found:{path:string;cwd:boolean}[]=[];
  const visit=(value:unknown,depth:number):boolean=>{if(depth>32)return false;if(value&&typeof value==='object'){for(const [key,item]of Object.entries(value)){if(paths.has(key)){if(key==='grantRoot'&&item===null)continue;if(key==='grantRoot'&&typeof item==='string'&&item.split(/[\\/]/).includes('..'))return false;if(typeof item!=='string'||item.includes('\0')||item.length>4096)return false;found.push({path:item,cwd:['cwd','workingDirectory','working_directory'].includes(key)});}else if(!visit(item,depth+1))return false;}}return true;};
  if(!visit(tool.arguments,0))return yield* Effect.fail(denied());
  const root=yield* canonicalWorkspacePath('.',context).pipe(Effect.mapError(denied));
  for(const item of found){const absolute=isAbsolute(item.path)?resolve(item.path):resolve(root,item.path),path=yield* canonicalWorkspacePath(absolute,context).pipe(Effect.mapError(denied));
   if(!inside(root,path)||relative(root,path).split(sep).some(p=>p.toLowerCase()==='.git'))return yield* Effect.fail(denied());
   if(writes(tool.name)&&!item.cwd){const allowed=yield* Effect.forEach(context.workspace.writablePaths,p=>canonicalWorkspacePath(p,context).pipe(Effect.mapError(denied)));if(!allowed.some(p=>inside(p,path)))return yield* Effect.fail(denied());}
  }
  const authorization=`pel-native-permission-${sha256Hex(canonicalize({effectId:request.effectId,identity,callId:tool.callId,name:tool.name,arguments:tool.arguments,policy,workspaceIdentity:context.workspace.directoryIdentity}))}`;
  if(tool.authorizationBinding!==policy.hostPermissionPortRef&&tool.authorizationBinding!==authorization)return yield* Effect.fail(denied());
  return authorization;
 });
}
/** This authorizes the provider's in-boundary operation; it does not execute a host shell or filesystem tool. */
export function makePelNativePermissionExecutor(request:ProviderRequestV1,context:HostContextV1):PelToolExecutorV1 {
 const authorize=makePelNativePermissionAuthorizer(request,context);
 return {execute:(identity,tool,authorization,current)=>Effect.gen(function*(){
  if(current.effect.effectId!==context.effect.effectId||current.workspace.directoryIdentity!==context.workspace.directoryIdentity)return yield* Effect.fail(denied());
  const valid=yield* authorize(identity,tool,request.toolPolicy);if(valid!==authorization||tool.authorizationBinding!==valid)return yield* Effect.fail(denied());
  return {content:{kind:'json' as const,value:{decision:'accept'}},isError:false};
 })};
}
