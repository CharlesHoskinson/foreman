/** Product lifecycle assembly over registered project state and existing host services. */
import {makePelInstalledAdmission} from './pel-install-admission.js';
import {existsSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Effect,Layer} from 'effect';
import {RunJournal,makeLiveRunJournalLayer,type RunId} from '@foreman/event-log';
import {hashAuthoringContent,validateAuthoringSnapshotV1,type CheckedProgramV1,type AuthoringProviderControlsV1} from '@foreman/pel';
import {CredentialPort,admitCell,resolveProfile,createXaiResponsesTransport,createAnthropicMessagesTransport,createOpenaiResponsesTransport,createGoogleInteractionsTransport,type HostPermissionPort,type ProviderRequestV1,type ProviderFailure,type ProviderTransport} from '@foreman/providers';
import {EndstopLedger,makeLiveEndstopLedgerLayer} from './execution-ledger.js';
import {executionContractSha256,type ExecutionMilestone} from './execution-contract.js';
import {makeLiveRunLease,makeLiveTypedJournalReader} from './supervisor-live-services.js';
import {readPelLegacyStatus} from './pel-legacy-status.js';
import {PelSupervisorRecovery} from './supervisor.js';
import {loadProjectRegistryFileV1} from './project-registry.js';
import {resumeProgram} from './pel-recovery.js';
import {registerPelOperatorDecision} from './pel-decision-authority.js';
import {makeLivePelProjectServices,resolvePelRepository} from './pel-project-live.js';
import {resolvePelRegisteredRoot,type PelRegisteredRootV1} from './pel-registered-root.js';
import {configurePelSnapshot,type PelValidatedAuthorityV1} from './pel-project-config.js';
import {resolvePelProjectAuthority,resolvePelRegisteredCandidate,validatePelRegisteredDecisionAuthority,type PelAuthorityInputReaderV1} from './pel-project-authority.js';
import {makeLivePelArtifactPort,pelFailure} from './pel-journal.js';
import {makePelResourceScope} from './pel-resource-scope.js';
import {makePelControlHandlers} from './pel-control-functions.js';
import {makePelPredicateHandler} from './pel-native-host.js';
import {makePelExecutionProviderPort} from './pel-execution-provider-live.js';
import {makePelHostLibraryServices,makeForemanHostRegistry} from './pel-host-library.js';
import {preflightPelDeliveryProviders} from './pel-host-preflight.js';
import {makePelTaskHandler} from './pel-host-task.js';
import {loadPelResearchBundleInputs,makePelImmutableResearchHandler} from './pel-research-host.js';
import {makeLivePelNativeServices} from './pel-native-live.js';
import {makePelNativePermissionAuthorizer,makePelNativePermissionExecutor} from './pel-native-permissions.js';
import {projectPelHostReceiptEvidence} from './pel-host-evidence.js';
import {inspectPelCandidate} from './pel-candidate-capture.js';
import {ProcessExec,liveProcessExec} from './queue-services.js';
import {loadImmutablePelRunInputs,parsePelInputJson} from './pel-runtime-inputs.js';
import {readPelExecutionBinding} from './pel-run-status.js';
import {makePelLifecycleServices,type PelLifecycleBackend,type PelLoadedProjectV1} from './pel-lifecycle-services.js';
import {PelRuntime,type PelRuntimePorts,type PelArtifactRefV1,type ForemanProjectV1,type RunFailure,type RunServices,type ExecutionBindingV1} from './pel-run-contract.js';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {makeLiveProviderCredentials,type LiveProviderContext} from './pel-provider-live.js';
import {withLiveProviderReadiness} from './pel-provider-readiness-live.js';
import {readProviderEvidence} from './pel-provider-evidence.js';
import {authoringFailure,type AuthoringFailure,type AuthoringOutputPort} from './pel-authoring-contract.js';
import type {PelLifecycleCliServices} from './pel-lifecycle-cli.js';

import {PEL_EXECUTION_RUNTIME_VERSION,PEL_EXECUTION_HANDLER_VERSION} from './pel-runtime-version.js';
export {PEL_EXECUTION_RUNTIME_VERSION,PEL_EXECUTION_HANDLER_VERSION} from './pel-runtime-version.js';
const handlerIds=new Set(['print','fm/checkpoint','fm/retry','fm/race','pel/nl-condition','fm/task','fm/verify','fm/review','fm/publish','fm/research']);
const asAuthoring=(error:RunFailure):AuthoringFailure=>authoringFailure(error.code,error.diagnostic.message);
const providerFailure=(message:string):ProviderFailure=>({_tag:'UnsupportedCapability',retryClass:'never',message});
const denyPermissions:HostPermissionPort={authorize:()=>Effect.fail(providerFailure('This execution host has no admitted native tool boundary.')),submit:()=>Effect.fail(providerFailure('This execution host has no admitted tool-result channel.'))};
const apiVersions:Readonly<Record<string,string>>={'xai-responses':'v1','anthropic-messages':'2023-06-01','openai-responses':'v1','google-interactions':'v1beta'};
export interface PelLiveLifecycleOptions {
  readonly entryUrl?:string;
  readonly cwd:string;
  readonly foremanHome:string;
  readonly userHome:string;
  readonly environment:Readonly<Record<string,string|undefined>>;
  readonly output:AuthoringOutputPort;
}
function reference(bytes:Uint8Array):PelArtifactRefV1 {
  // Same exact-byte content addressing as run artifacts, including authority file newlines.
  const sha256=importHash(bytes);return {artifactId:`sha256-${sha256}`,byteLength:bytes.byteLength,sha256};
}
import {sha256Hex as importHash} from '@foreman/core';

export function makeLivePelLifecycleBackend(options:PelLiveLifecycleOptions):PelLifecycleBackend {
  const admission=makePelInstalledAdmission(options.entryUrl??import.meta.url,options.foremanHome);
  const registryDigest=createDefaultAuthoringSnapshotV1().registryDigest;
  const projectServices=makeLivePelProjectServices({cwd:options.cwd,foremanHome:options.foremanHome,entryUrl:options.entryUrl??import.meta.url,
    validateAuthority:(project,read,readHash)=>Effect.gen(function*(){
      const reader:PelAuthorityInputReaderV1=(locator,max)=>'byteLength' in locator?read(locator,max):readHash(locator.sha256,max);
      yield* resolvePelProjectAuthority(project,reader);
      yield* loadPelResearchBundleInputs(project,read);
      const parsed=validateAuthoringSnapshotV1(yield* parsePelInputJson(yield* read(project.authoringSnapshot,16777216)));
      if(!parsed.ok||parsed.value.registryDigest!==registryDigest||!configurePelSnapshot(parsed.value,project).ok)return yield* Effect.fail(pelFailure('binding-mismatch','The project snapshot or selections differ from this runtime.'));
    }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(project.stateRoot)))});
  const liveContext=(root:{stateRoot:string;worktreePath:string}):LiveProviderContext=>({stateRoot:root.stateRoot,worktreeRoot:root.worktreePath,userHome:options.userHome,environment:options.environment});
  const loadProject=(override?:string):Effect.Effect<PelLoadedProjectV1,AuthoringFailure>=>Effect.gen(function*(){
    const project=yield* projectServices.read(override);
    const read:PelAuthorityInputReaderV1=(locator,max)=>'byteLength' in locator?projectServices.input.read(project,locator,max):projectServices.readHash(project,locator.sha256,max);
    const resolved=yield* resolvePelProjectAuthority(project,read).pipe(Effect.provide(makeLiveEndstopLedgerLayer(project.stateRoot)));
    const snapshotBytes=yield* projectServices.input.read(project,project.authoringSnapshot,16777216),snapshot=validateAuthoringSnapshotV1(yield* parsePelInputJson(snapshotBytes));
    if(!snapshot.ok||snapshot.value.registryDigest!==registryDigest||project.runtimeHandlerVersion!==PEL_EXECUTION_HANDLER_VERSION)return yield* Effect.fail(pelFailure('binding-mismatch','The configured snapshot or handler version is unavailable.'));
    const authority:PelValidatedAuthorityV1={...resolved,availableHandlers:handlerIds};
    const researchInputs=yield* loadPelResearchBundleInputs(project,(ref,max)=>projectServices.input.read(project,ref,max));
    return {project,baseSnapshot:snapshot.value,authority,retainedInputs:[...resolved.retainedInputs,{ref:reference(snapshotBytes),bytes:snapshotBytes},...researchInputs]};
  }).pipe(Effect.mapError(asAuthoring));

  function services(root:Pick<PelRegisteredRootV1,'stateRoot'|'projectId'|'repository'|'worktreePath'>,outputMode:'text'|'json'='text'):Layer.Layer<RunServices,AuthoringFailure>{
    const journalLayer=makeLiveRunJournalLayer(root.stateRoot),ledgerLayer=makeLiveEndstopLedgerLayer(root.stateRoot),leaseLayer=makeLiveRunLease(root.stateRoot);
    const runtimeLayer=Layer.effect(PelRuntime,Effect.gen(function*(){
      const journal=yield* RunJournal,ledger=yield* EndstopLedger,processExec=yield* ProcessExec,artifacts=makeLivePelArtifactPort(root.stateRoot),native=makeLivePelNativeServices(liveContext(root));
      const resources=yield* makePelResourceScope({readResearchIndex:(context,ref,max)=>artifacts.get(context.binding.runId,ref,max).pipe(Effect.mapError(()=>({code:'artifact-missing' as const,message:'The original research index is unavailable or changed.'})))});
      const retained=(runId:RunId):PelAuthorityInputReaderV1=>(locator,max)=>Effect.gen(function*(){
        let ref:PelArtifactRefV1;
        if('byteLength' in locator)ref=locator;
        else{
          if(!/^[a-f0-9]{64}$/.test(locator.sha256))return yield* Effect.fail(pelFailure('binding-mismatch','Invalid authority input hash.'));
          const byteLength=yield* Effect.try({try:()=>lstatSync(join(root.stateRoot,'runs',runId,'artifacts',`sha256-${locator.sha256}`)).size,catch:()=>pelFailure('binding-mismatch','The original authority input is missing.')});
          ref={artifactId:`sha256-${locator.sha256}`,sha256:locator.sha256,byteLength};
        }
        return yield* artifacts.get(runId,ref,max);
      });
      let runtime:PelRuntimePorts;
      const handlers=new Map<string,import('./pel-run-contract.js').PelPreparedHandlerV1>();
      runtime={admission,artifacts,resources,clock:{now:Effect.sync(Date.now),sleep:Effect.sleep},handlers,controls:makePelControlHandlers(),
        output:(_ref,text)=>outputMode==='json'?Effect.void:options.output.stderr(text).pipe(Effect.mapError(()=>pelFailure('journal-write-failed','Program output could not be written.'))),
        providers:makePelExecutionProviderPort({live:liveContext(root),journal,runtime:()=>runtime,permissions:denyPermissions,nativeBoundary:native.boundary,nativeAuthorize:makePelNativePermissionAuthorizer,nativeToolExecutor:makePelNativePermissionExecutor}),
        validateDecisionAuthority:validatePelRegisteredDecisionAuthority,
        loadRunInputs:binding=>Effect.gen(function*(){
          if(binding.stateRoot!==root.stateRoot||hashAuthoringContent(binding.repository)!==hashAuthoringContent(root.repository))return yield* Effect.fail(pelFailure('binding-mismatch','Run state belongs to another registered repository.'));
          const restored=yield* loadImmutablePelRunInputs(binding,{artifacts,runtimeVersion:PEL_EXECUTION_RUNTIME_VERSION,runtimeHandlerVersion:PEL_EXECUTION_HANDLER_VERSION,registryDigest,
            resolveAuthority:(project)=>resolvePelProjectAuthority(project,retained(binding.runId)).pipe(Effect.provideService(EndstopLedger,ledger),Effect.map(authority=>({...authority,availableHandlers:handlerIds})))});
          if(restored.project.projectId!==root.projectId)return yield* Effect.fail(pelFailure('binding-mismatch','The run belongs to another project.'));
          return restored;
        }),
        hostEvidence:binding=>Effect.gen(function*(){
          const state=yield* ledger.status(binding.contractId).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','Registered execution evidence is unavailable.')));
          if(state.contractSha256!==binding.contractSha256)return yield* Effect.fail(pelFailure('binding-mismatch','Execution evidence belongs to another contract.'));
          let candidate=state.currentCandidateSha256,milestoneCandidate=state.milestoneCandidateSha256,earned=state.milestones;
          if(binding.authority.kind==='v2-child'){
            const family=yield* ledger.familyStatus(binding.authority).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','Registered child evidence is unavailable.'))),child=family.family.children[binding.authority.childId];
            if(!child)return yield* Effect.fail(pelFailure('binding-mismatch','The registered child is absent.'));
            candidate=child.currentCandidate?.candidateSha256??null;milestoneCandidate=child.milestoneCandidateSha256;earned=child.milestones;
          }
          const milestones:ExecutionMilestone[]=candidate!==null&&candidate===milestoneCandidate?(Object.keys(earned) as ExecutionMilestone[]):[];
          const receipts=yield* projectPelHostReceiptEvidence(binding,candidate).pipe(Effect.provideService(PelRuntime,runtime),Effect.provideService(RunJournal,journal));
          return {milestones,...receipts};
        }),
      };
      handlers.set('pel/nl-condition',makePelPredicateHandler({runtime,
        transportVersion:context=>context.checked.snapshot.nlConditionProfile&&Object.hasOwn(apiVersions,context.checked.snapshot.nlConditionProfile.transportId)?Effect.succeed('1'):Effect.fail({code:'capability-denied',message:'This host has no admitted native predicate boundary.'}),
        candidate:context=>resolvePelRegisteredCandidate(context.binding.authority,'evaluate').pipe(Effect.provideService(EndstopLedger,ledger),Effect.map(record=>record.candidate),Effect.mapError(error=>({code:'capability-denied',message:error.diagnostic.message}))),
      }));
      const retainAuthorityByHash=(sha256:string,context:import('./pel-run-contract.js').HostContextV1)=>Effect.gen(function*(){
        const bytes=yield* projectServices.readHash(context.project,sha256,64*1024*1024);
        if(importHash(bytes)!==sha256)return yield* Effect.fail(pelFailure('binding-mismatch','Registered action authority bytes changed.'));
        return yield* artifacts.put(context.binding.runId,bytes,64*1024*1024,'ordinary');
      });
      const library=makePelHostLibraryServices({journal,ledger,processExec,runtime:()=>runtime,transportVersion:native.transportVersion,retainAuthorityByHash,
        readAuthority:(ref,context)=>artifacts.get(context.binding.runId,ref,64*1024*1024).pipe(Effect.catchAll(()=>Effect.gen(function*(){
          const bytes=yield* projectServices.input.read(context.project,ref,64*1024*1024),retainedRef=yield* artifacts.put(context.binding.runId,bytes,64*1024*1024,'ordinary');
          if(hashAuthoringContent(retainedRef)!==hashAuthoringContent(ref))return yield* Effect.fail(pelFailure('binding-mismatch','The original publication authority reference changed.'));
          return bytes;
        }))),
      });
      handlers.set('fm/task',makePelTaskHandler({resolveInput:library.resolveTaskInput,nativePolicy:native.nativePolicy,transportVersion:native.transportVersion,recordImplementation:library.recordImplementation,actionAuthority:(action,candidate,context)=>library.actionAuthority(action,candidate,context).pipe(Effect.mapError(error=>'_tag' in error?error:pelFailure('binding-mismatch',error.message))),
        allowedPathsSha256:context=>Effect.gen(function*(){
          if(context.binding.authority.kind==='v2-child'){
            const family=yield* ledger.familyStatus(context.binding.authority).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','The original child path authority is unavailable.'))),child=family.family.children[context.binding.authority.childId];
            if(!child)return yield* Effect.fail(pelFailure('binding-mismatch','The registered child is absent.'));
            return child.contract.allowedPathsSha256;
          }
          const state=yield* ledger.status(context.binding.contractId).pipe(Effect.mapError(()=>pelFailure('binding-mismatch','The original path authority is unavailable.')));
          if(state.contractSha256!==context.binding.contractSha256)return yield* Effect.fail(pelFailure('binding-mismatch','The original path authority changed.'));
          return state.contract.allowedPathsSha256;
        }),
        actionCandidate:(action,context)=>context.binding.authority.kind==='v2-child'?resolvePelRegisteredCandidate(context.binding.authority,action).pipe(Effect.provideService(EndstopLedger,ledger),Effect.map(row=>row.candidate)):inspectPelCandidate(context).pipe(Effect.provideService(PelRuntime,runtime),Effect.provideService(ProcessExec,processExec),Effect.map(observed=>({commit:observed.headCommit,tree:observed.headTree,candidateSha256:importHash(observed.headCommit)})),Effect.mapError(error=>pelFailure('binding-mismatch',error.message))),
      }));
      Object.assign(runtime,{workspaceForHostRequest:library.workspaceForHostRequest,commitRaceWinner:library.commitRaceWinner});
      handlers.set('fm/verify',library.verification);handlers.set('fm/review',library.review);handlers.set('fm/publish',library.publication);
      handlers.set('fm/research',makePelImmutableResearchHandler());
      makeForemanHostRegistry(handlers);
      return runtime;
    })).pipe(Layer.provide(Layer.mergeAll(journalLayer,ledgerLayer,liveProcessExec)));
    return Layer.mergeAll(runtimeLayer,journalLayer,ledgerLayer,leaseLayer);
  }
  const rootFromLoaded=(loaded:PelLoadedProjectV1)=>({stateRoot:loaded.project.stateRoot,projectId:loaded.project.projectId,repository:loaded.project.repository,worktreePath:loaded.project.workspaces.grants[0]!.canonicalRoot});
  const backend:PelLifecycleBackend={runtimeVersion:PEL_EXECUTION_RUNTIME_VERSION,evidenceKind:'product',now:Effect.sync(Date.now),load:loadProject,
    configure:bytes=>projectServices.configure(bytes).pipe(Effect.asVoid,Effect.mapError(asAuthoring)),services:(loaded,outputMode)=>services(rootFromLoaded(loaded),outputMode),
    registerOperatorDecision:(context,kind,input,source)=>kind==='recovery'?registerPelOperatorDecision(context.binding,context,'recovery',input):registerPelOperatorDecision(context.binding,context,'revision',input,source),
    legacyStatus:(runId,override)=>Effect.gen(function*(){
      const root=yield* resolvePelRegisteredRoot(options.cwd,options.foremanHome,override).pipe(Effect.mapError(asAuthoring));
      return yield* readPelLegacyStatus(runId).pipe(Effect.provide(makeLiveTypedJournalReader(root.stateRoot)));
    }),
    servicesForRun:(runId,override,outputMode)=>Effect.gen(function*(){
      const root=yield* resolvePelRegisteredRoot(options.cwd,options.foremanHome,override).pipe(Effect.mapError(asAuthoring)),layer=services(root,outputMode);
      const binding=yield* readPelExecutionBinding(runId).pipe(Effect.mapError(asAuthoring),Effect.provide(layer));
      if(binding.stateRoot!==root.stateRoot||hashAuthoringContent(binding.repository)!==hashAuthoringContent(root.repository))return yield* Effect.fail(authoringFailure('binding-mismatch','The selected run belongs to another registered root.'));
      return layer;
    }),
    configured:()=>Effect.gen(function*(){
      const location=yield* Effect.either(resolvePelRepository(options.cwd));if(location._tag==='Left')return null;
      if(!existsSync(join(location.right.repository.gitCommonDir,'foreman','project.json')))return null;
      return yield* loadProject();
    }),
    preflight:(checked,loaded)=>preflight(checked,loaded),
  };
  function preflight(checked:CheckedProgramV1,loaded:PelLoadedProjectV1):Effect.Effect<void,AuthoringFailure>{return Effect.gen(function*(){
    const active=yield* Effect.flatMap(EndstopLedger,ledger=>ledger.status(loaded.authority.contract.contractId)).pipe(Effect.provide(makeLiveEndstopLedgerLayer(loaded.project.stateRoot)),Effect.mapError(()=>authoringFailure('binding-mismatch','The execution contract is unavailable.')));
    if(active._tag!=='Running'||active.contractSha256!==executionContractSha256(loaded.authority.contract))return yield* Effect.fail(authoringFailure('binding-mismatch','Fresh execution requires the matching active contract.'));
    const reachable=new Set([...checked.analysis.effects.map(e=>e.registryId),...checked.analysis.dynamicRegions.flatMap(r=>r.possibleRegistryIds)]);
    for(const id of reachable)if(!handlerIds.has(id))return yield* Effect.fail(authoringFailure('binding-mismatch',`The runtime has no handler for ${id}.`));
    yield* preflightPelDeliveryProviders(checked,liveContext(rootFromLoaded(loaded)));
    if(!reachable.has('pel/nl-condition'))return;
    const selection=checked.snapshot.nlConditionProfile;
    if(!selection||loaded.authority.binding.kind!=='v2-child'||!Object.hasOwn(apiVersions,selection.transportId))return yield* Effect.fail(authoringFailure('binding-mismatch','The predicate lacks registered V2 evaluation authority or an admitted transport boundary.'));
    yield* resolvePelRegisteredCandidate(loaded.authority.binding,'evaluate').pipe(Effect.provide(makeLiveEndstopLedgerLayer(loaded.project.stateRoot)),Effect.mapError(asAuthoring));
    const profile=resolveProfile(selection.profileId);if(!profile.ok)return yield* Effect.fail(authoringFailure('binding-mismatch',profile.error.message));
    const live=liveContext(rootFromLoaded(loaded)),evidence=yield* readProviderEvidence(live).pipe(Effect.mapError(e=>authoringFailure('binding-mismatch',e.message)));
    const controls=selection.controls as unknown as AuthoringProviderControlsV1;
    const admitted=admitCell(selection.profileId,selection.transportId as ProviderRequestV1['transportId'],['generation','structuredOutput','toolPolicyNone'],evidence,{kind:'product',expectedIdentityRevision:apiVersions[selection.transportId]!,now:Date.now(),transportVersion:'1',controls,credentialProfileRef:selection.credentialProfileRef});
    if(!admitted.ok)return yield* Effect.fail(authoringFailure('binding-mismatch',admitted.error.message));
    const transportId=selection.transportId as ProviderRequestV1['transportId'],credentials=makeLiveProviderCredentials(live,transportId),shared={credentials,schemaRegistry:checked.snapshot.registry.dataSchemas};
    const transport:ProviderTransport=transportId==='xai-responses'?createXaiResponsesTransport(shared):transportId==='anthropic-messages'?createAnthropicMessagesTransport(shared):transportId==='openai-responses'?createOpenaiResponsesTransport(shared):createGoogleInteractionsTransport(shared);
    const request:ProviderRequestV1={schemaVersion:1,effectId:'pel-preflight',profileId:profile.value.id,transportId,transportVersion:'1',profileHash:profile.value.profileHash,sourceManifestHash:profile.value.sourceManifestHash,credentialProfileRef:selection.credentialProfileRef,controls,trustedInstructions:'Metadata-only readiness check.',artifacts:[],toolPolicy:{mode:'none'},outputSchema:{id:'schema:pel-boolean-v1',content:{type:'boolean'}},limits:{deadline:Date.now()+10000,maxInputTokens:1,maxOutputTokens:1,maxToolCalls:0,maxCostUsd:0,maxOutputBytes:1024,spendReservationRef:'metadata-only'}};
    const readiness=yield* withLiveProviderReadiness(transport,request,live).probe({profileId:request.profileId,transportId,credentialProfileRef:request.credentialProfileRef,mode:'metadata-only'}).pipe(Effect.mapError(e=>authoringFailure('binding-mismatch',e.message)));
    if(readiness.discovery.state!=='available'||readiness.authentication.state!=='authenticated'||readiness.currency.state!=='current'||readiness.identity.state!=='exact')return yield* Effect.fail(authoringFailure('binding-mismatch','Current provider readiness is incomplete.'));
  });}
  return backend;
}
export function makeLivePelLifecycleServices(options:PelLiveLifecycleOptions):PelLifecycleCliServices {
  return makePelLifecycleServices(makeLivePelLifecycleBackend(options));
}
/** The existing supervisor retains its lease; this adapter only loads and resumes the Pel owner. */
export function makeLivePelSupervisorRecovery(stateRoot:string,options:PelLiveLifecycleOptions):Layer.Layer<PelSupervisorRecovery>{
  return Layer.succeed(PelSupervisorRecovery,{recover:(runId,owner)=>Effect.gen(function*(){
    const cwd=yield* Effect.try({try:()=>{
      const registry=loadProjectRegistryFileV1(join(options.foremanHome,'projects.json'));if(registry._tag!=='Valid')throw Error('registry');
      const matches=registry.value.projects.filter(p=>p.state==='active'&&p.store_location===stateRoot);
      if(matches.length!==1||!matches[0]!.worktree_paths.length)throw Error('association');
      return matches[0]!.worktree_paths[0]!;
    },catch:()=>pelFailure('binding-mismatch','The supervised run has no active registered project root.')});
    const backend=makeLivePelLifecycleBackend({...options,cwd}),layer=yield* backend.servicesForRun(runId,stateRoot).pipe(Effect.mapError(e=>pelFailure('binding-mismatch',e.message)));
    return yield* Effect.gen(function*(){
      const binding=yield* readPelExecutionBinding(runId),runtime=yield* PelRuntime,inputs=yield* runtime.loadRunInputs(binding);
      return yield* resumeProgram(runId,{...inputs,owner});
    }).pipe(Effect.provide(layer),Effect.mapError(e=>'_tag' in e&&e._tag==='AuthoringFailure'?pelFailure('binding-mismatch',e.message):e));
  })});
}
export function defaultPelLifecycleOptions(output:AuthoringOutputPort):PelLiveLifecycleOptions {
  return {cwd:process.cwd(),foremanHome:process.env.FOREMAN_HOME??join(homedir(),'.foreman'),userHome:homedir(),environment:process.env,output};
}
