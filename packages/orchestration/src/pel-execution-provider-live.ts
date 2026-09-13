/** Assemble M3 adapters for admitted execution, separately from disposable qualification hosts. */
import { Effect } from 'effect';
import type { Scope } from 'effect';
import { canonicalAuthoringJson } from '@foreman/pel';
import { admitCell, createXaiResponsesTransport, createAnthropicMessagesTransport, createOpenaiResponsesTransport, createGoogleInteractionsTransport, createGrokAcpTransport, createClaudeCodeTransport, createCodexAppServerTransport, createGeminiCliTransport, validateNativeHost, resolveProfile, type NativeHostPort, type ProviderRequestV1, type ProviderTransport, type ProviderFailure, type HostPermissionPort, type GeminiConfigurationV1, type CapabilityEvidenceV1, type Capability, type ProviderIdentityV1, type ApiHttpPort, type ReadinessV1 } from '@foreman/providers';
import { RunJournal } from '@foreman/event-log';
import { makeLiveProviderCredentials, type LiveProviderContext } from './pel-provider-live.js';
import { withLiveProviderReadiness } from './pel-provider-readiness-live.js';
import { readProviderEvidence } from './pel-provider-evidence.js';
import { canonicalWorkspacePath } from './pel-resource-scope.js';
import { readPelRecords, replayPelRun, pelFailure, pelHash } from './pel-journal.js';
import type { HostContextV1, PelProviderPort, PelRuntimePorts, RunFailure, PelArtifactRefV1 } from './pel-run-contract.js';
const failure=(message:string):ProviderFailure=>({_tag:'CapabilityUnverified',retryClass:'never',message});
const asRun=(error:ProviderFailure):RunFailure=>pelFailure('binding-mismatch',`Execution provider admission failed: ${error._tag}.`);
const api=(transportId:string):boolean=>['xai-responses','anthropic-messages','openai-responses','google-interactions'].includes(transportId);
export interface PelExecutionNativeBoundaryV1 {
 readonly host:NativeHostPort;
 /** Independently admitted endpoint/protocol revision; not the adapter build version. */
 readonly identityRevision:string;
 readonly geminiConfiguration?:GeminiConfigurationV1;
}
export interface PelExecutionTransportOptions {
 readonly live:LiveProviderContext;
 readonly permissions:HostPermissionPort;
 /** This host capability is supplied by an enforcing launcher/sandbox boundary. No default asserts enforcement. */
 readonly nativeBoundary?:(request:ProviderRequestV1,context:HostContextV1)=>Effect.Effect<PelExecutionNativeBoundaryV1,ProviderFailure,Scope.Scope>;
 readonly http?:ApiHttpPort;
 readonly requestForIdentity?:(identity:ProviderIdentityV1)=>Effect.Effect<ProviderRequestV1,ProviderFailure>;
}
export function makeExecutionProviderTransport(request:ProviderRequestV1,context:HostContextV1,options:PelExecutionTransportOptions):Effect.Effect<ProviderTransport,ProviderFailure,Scope.Scope> {
 return Effect.gen(function*(){
  const credentials=makeLiveProviderCredentials({...options.live,worktreeRoot:context.workspace?.canonicalRoot??options.live.worktreeRoot},request.transportId);
  const shared={credentials,schemaRegistry:context.checked?.snapshot.registry.dataSchemas,...(options.http?{http:options.http}:{}),...(options.requestForIdentity?{requestForIdentity:options.requestForIdentity}:{})};
  switch(request.transportId) {
   case 'xai-responses':return createXaiResponsesTransport(shared);
   case 'anthropic-messages':return createAnthropicMessagesTransport(shared);
   case 'openai-responses':return createOpenaiResponsesTransport(shared);
   case 'google-interactions':return createGoogleInteractionsTransport(shared);
  }
  if(!options.nativeBoundary) return yield* Effect.fail(failure('Native execution needs an admitted enforcing host boundary.'));
  yield* canonicalWorkspacePath('.',context).pipe(Effect.mapError(()=>failure('The admitted native workspace identity changed.')));
  const boundary=yield* options.nativeBoundary(request,context);
  if(boundary.host.cwd!==context.workspace.canonicalRoot) return yield* Effect.fail(failure('Native process cwd differs from its admitted worktree.'));
  const host={...boundary.host,permissions:options.permissions};
  const checked=validateNativeHost(request,host);if(!checked.ok) return yield* Effect.fail(checked.error);
  if(request.toolPolicy.mode==='native-coding' && (request.toolPolicy.workspaceGrantId!==context.workspace.grantId || !context.workspace.writablePaths.length)) return yield* Effect.fail(failure('Native tool policy does not match its writable workspace grant.'));
  const native={credentials,host,schemaRegistry:context.checked.snapshot.registry.dataSchemas};
  switch(request.transportId) {
   case 'grok-acp':return createGrokAcpTransport({...native,version:request.transportVersion});
   case 'claude-code':return createClaudeCodeTransport({...native,version:request.transportVersion});
   case 'codex-app-server':return createCodexAppServerTransport({...native,version:request.transportVersion});
   case 'gemini-cli':
    if(!boundary.geminiConfiguration) return yield* Effect.fail(failure('Gemini execution needs immutable host-enforced configuration.'));
    return createGeminiCliTransport({...native,protocolVersion:boundary.identityRevision,configuration:boundary.geminiConfiguration});
  }
 });
}
export interface PelExecutionProviderOptions extends PelExecutionTransportOptions {
 readonly journal:typeof RunJournal.Service;
 readonly runtime:()=>PelRuntimePorts;
 readonly readEvidence?:(live:LiveProviderContext)=>Effect.Effect<readonly CapabilityEvidenceV1[],ProviderFailure>;
 /** Metadata-only readiness injection. Product default reuses M3's existing live readiness. */
 readonly readiness?:(transport:ProviderTransport,request:ProviderRequestV1)=>Effect.Effect<ReadinessV1,ProviderFailure>;
}
/** The journal identifies the original immutable request, even after the process-local adapter map is gone. */
export function loadOriginalPelProviderRequest(identity:ProviderIdentityV1,context:HostContextV1,options:Pick<PelExecutionProviderOptions,'journal'|'runtime'>):Effect.Effect<ProviderRequestV1,RunFailure> {
 return Effect.gen(function*(){
  const replay=replayPelRun(yield* readPelRecords(context.binding.runId));if(!replay.ok) return yield* Effect.fail(replay.error);
  let reference:PelArtifactRefV1|null=null;
  let observedIdentity=false;
  for(const record of replay.value.records) if(record.type==='pel.effect.observed.v1' && record.data.effectId===context.effect.effectId) {
   if(record.data.providerIdentity && canonicalAuthoringJson(record.data.providerIdentity)===canonicalAuthoringJson(identity)) observedIdentity=true;
   const bytes=yield* options.runtime().artifacts.get(context.binding.runId,record.data.observationRef,64*1024*1024);
   const value:unknown=yield* Effect.try({try:()=>JSON.parse(Buffer.from(bytes).toString('utf8')),catch:()=>pelFailure('binding-mismatch','Stored provider observation is invalid.')});
   if(value && typeof value==='object' && 'requestRef' in value) reference=value.requestRef as PelArtifactRefV1;
  }
  if(!reference || !observedIdentity) return yield* Effect.fail(pelFailure('binding-mismatch','The journal does not bind this provider identity to an original request.'));
  const bytes=yield* options.runtime().artifacts.get(context.binding.runId,reference,64*1024*1024);
  return yield* Effect.try({try:()=>{
   const request=JSON.parse(Buffer.from(bytes).toString('utf8')) as ProviderRequestV1;
   const profile=resolveProfile(request.profileId),schema=context.checked.snapshot.registry.dataSchemas[request.outputSchema.id];
   if(request.schemaVersion!==1 || request.effectId!==context.effect.effectId || request.profileId!==identity.profileId || request.transportId!==identity.transportId || request.credentialProfileRef!==identity.credentialProfileRef || !profile.ok || request.profileHash!==profile.value.profileHash || request.sourceManifestHash!==profile.value.sourceManifestHash || !schema || pelHash(schema)!==pelHash(request.outputSchema.content)) throw Error('request');
   const originalSchema=replay.value.intents.get(context.effect.effectId)?.expectedResultSchemaId;
   if(originalSchema && originalSchema!==request.outputSchema.id) throw Error('schema');
   const {continuation:_,...ordinary}=request;
   return ordinary;
  },catch:()=>pelFailure('binding-mismatch','The stored provider request differs from its original schema, profile or identity.')});
 }).pipe(Effect.provideService(RunJournal,options.journal));
}
export function makePelExecutionProviderPort(options:PelExecutionProviderOptions):PelProviderPort {
 const make=(request:ProviderRequestV1,context:HostContextV1,boundary?:PelExecutionNativeBoundaryV1)=>makeExecutionProviderTransport(request,context,{...options,...(boundary?{nativeBoundary:()=>Effect.succeed(boundary)}:{}),requestForIdentity:identity=>loadOriginalPelProviderRequest(identity,context,options).pipe(Effect.mapError(()=>failure('The original provider request is unavailable.')))});
 return {
  permissions:options.permissions,
  resolve:(request,context)=>Effect.gen(function*(){
   if(context.binding.evidenceKind!=='product') return yield* Effect.fail(pelFailure('binding-mismatch','Live execution does not accept fixture bindings.'));
   if(request.effectId!==context.effect.effectId || context.binding.stateRoot!==options.live.stateRoot) return yield* Effect.fail(pelFailure('binding-mismatch','Provider request does not match its admitted run.'));
   yield* canonicalWorkspacePath('.',context).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','Provider workspace identity changed.')));
   const evidence=yield* (options.readEvidence??readProviderEvidence)(options.live);
   const required:Capability[]=['generation','structuredOutput',...(request.toolPolicy.mode==='native-coding'?['codingTask','tools','permissionBoundary','workspaceBoundary'] as const:['toolPolicyNone'] as const)];
   const now=yield* options.runtime().clock.now;
   let boundary:PelExecutionNativeBoundaryV1|undefined;
   if(!api(request.transportId)) {
     if(!options.nativeBoundary) return yield* Effect.fail(pelFailure('binding-mismatch','Native provider needs an admitted execution boundary.'));
     boundary=yield* options.nativeBoundary(request,context);
     if(!boundary.identityRevision) return yield* Effect.fail(pelFailure('binding-mismatch','Native identity revision is not independently admitted.'));
   }
   const revision=api(request.transportId)?({'xai-responses':'v1','openai-responses':'v1','anthropic-messages':'2023-06-01','google-interactions':'v1beta'} as Record<string,string>)[request.transportId]!:boundary!.identityRevision;
   const admitted=admitCell(request.profileId,request.transportId,required,evidence,{kind:'product',expectedIdentityRevision:revision,now,transportVersion:request.transportVersion,controls:request.controls,credentialProfileRef:request.credentialProfileRef});
   if(!admitted.ok) return yield* Effect.fail(admitted.error);
   const transport=yield* make(request,context,boundary);
   if(transport.version!==request.transportVersion) return yield* Effect.fail(pelFailure('binding-mismatch','Installed execution transport differs from admission.'));
   const ready=yield* (options.readiness?options.readiness(transport,request):withLiveProviderReadiness(transport,request,options.live).probe({profileId:request.profileId,transportId:request.transportId,credentialProfileRef:request.credentialProfileRef,mode:'metadata-only'}));
   if(ready.authentication.state!=='authenticated') return yield* Effect.fail({_tag:'AuthenticationRequired',retryClass:'never',message:'Current provider authentication is unavailable.'} as const);
   if(ready.discovery.state!=='available' || ready.currency.state!=='current' || ready.identity.state!=='exact') return yield* Effect.fail({_tag:'ProbeUnknown',retryClass:'never',message:'Current execution provider readiness is incomplete.'} as const);
   return {transport,admitted:admitted.value};
  }),
  observe:(identity,context)=>Effect.gen(function*(){
   const request=yield* loadOriginalPelProviderRequest(identity,context,options);
   if(!api(request.transportId) && !options.nativeBoundary) return {status:'unsupported' as const,providerIdentity:identity,reason:'No admitted native session host is attached for observation.'};
   const transport=yield* make(request,context).pipe(Effect.mapError(asRun));
   return yield* transport.observe(identity).pipe(Effect.mapError(asRun));
  }),
 };
}
