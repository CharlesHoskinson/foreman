/** Attach lifecycle commands to the existing journal, ledger and single run owner. */
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {projectPelDeliveryResult,formatPelDeliveryResultJson,formatPelDeliveryResultText} from './pel-delivery-result.js';
import {Effect,type Layer,type Scope} from 'effect';
import {RunJournal,type RunId,type LaneId,type AttemptIdentity} from '@foreman/event-log';
import {canonicalAuthoringJson,checkPel,hashAuthoringContent,parseAuthoringSnapshotV1,type AuthoringSnapshotV1,type CheckedProgramV1} from '@foreman/pel';
import {authoringFailure,type AuthoringFailure} from './pel-authoring-contract.js';
import {configurePelSnapshot,deriveExecutionBinding,type PelValidatedAuthorityV1} from './pel-project-config.js';
import {decodeExecutionBindingV1,decodePelContractJson,decodePelRecoveryDecisionV1,decodePelRevisionDecisionV1,PelRuntime,type PelArtifactRefV1,type ForemanProjectV1,type RunFailure,type RunServices,type ExecutionBindingV1} from './pel-run-contract.js';
import {appendPelRecord,pelBytesHash,pelFailure,readPelRecords,PEL_MAX_ARTIFACT_BYTES} from './pel-journal.js';
import {drivePelRun,withPelRunOwner} from './pel-runner.js';
import {resumeProgram,type PelResumeOptionsV1} from './pel-recovery.js';
import {pelStatus,cancelPelRun,readPelExecutionBinding} from './pel-run-status.js';
import type {PelLifecycleCliServices} from './pel-lifecycle-cli.js';
import {parsePelInputJson} from './pel-runtime-inputs.js';
import type {PelOwnedRunContextV1,PelRecoveryDecisionV1,PelRevisionDecisionV1} from './pel-run-contract.js';

export interface PelLoadedProjectV1 {
  readonly project:ForemanProjectV1;
  readonly baseSnapshot:AuthoringSnapshotV1;
  readonly authority:PelValidatedAuthorityV1;
  /** Validated source bytes for referenced contract, scope and registered family/bundle inputs. */
  readonly retainedInputs:readonly {readonly ref:PelArtifactRefV1;readonly bytes:Uint8Array}[];
}
export interface PelLifecycleBackend {
  readonly runtimeVersion:string;
  readonly evidenceKind:ExecutionBindingV1['evidenceKind'];
  readonly now:Effect.Effect<number>;
  /** Validates the existing registry association. Overrides cannot register a root. */
  readonly load:(stateRoot?:string)=>Effect.Effect<PelLoadedProjectV1,AuthoringFailure>;
  readonly configure:(bytes:Uint8Array)=>Effect.Effect<void,AuthoringFailure>;
  /** All services use this project's registered state root. No second store or lease. */
  readonly services:(loaded:PelLoadedProjectV1,outputMode?:'text'|'json')=>Layer.Layer<RunServices,AuthoringFailure>;
  /** Resolves only the registered root and immutable run inputs, not current project settings. */
  readonly servicesForRun:(runId:RunId,stateRoot?:string,outputMode?:'text'|'json')=>Effect.Effect<Layer.Layer<RunServices,AuthoringFailure>,AuthoringFailure>;
  /** Checks exact reachable provider/handler readiness before any run allocation. */
  readonly preflight:(checked:CheckedProgramV1,loaded:PelLoadedProjectV1)=>Effect.Effect<void,AuthoringFailure>;
  /** Outside a configured project, authoring can still use its explicit/default snapshot. */
  readonly configured:()=>Effect.Effect<PelLoadedProjectV1|null,AuthoringFailure>;
  /** Called only by the trusted operator resume route, inside existing run ownership. */
  readonly registerOperatorDecision?:(context:PelOwnedRunContextV1,kind:'recovery'|'revision',input:unknown,revisionSource?:Uint8Array)=>Effect.Effect<PelRecoveryDecisionV1|PelRevisionDecisionV1,RunFailure,RunServices|Scope.Scope>;
}
const failure=(error:RunFailure):AuthoringFailure=>authoringFailure(error.code,error.diagnostic.message,error.code==='binding-mismatch'||error.code==='owner-busy'||error.code==='terminal-run'||error.code==='continuation-incompatible'?2:1);
function checkedSource(source:Uint8Array,snapshot:AuthoringSnapshotV1):Effect.Effect<CheckedProgramV1,AuthoringFailure>{
  const checked=checkPel({source,snapshot});
  return checked.tag==='ok'?Effect.succeed(checked.checked):Effect.fail({...authoringFailure('binding-mismatch','The program does not satisfy the configured admission envelope.'),diagnostics:checked.diagnostics});
}
const bytes=(value:unknown)=>Buffer.from(canonicalAuthoringJson(value));
const reference=(data:Uint8Array)=>{const sha256=pelBytesHash(data);return {artifactId:`sha256-${sha256}`,byteLength:data.byteLength,sha256};};

export function makePelLifecycleServices(backend:PelLifecycleBackend):PelLifecycleCliServices {
  return {
    configure:backend.configure,
    renderResult:(result,format,stateRoot)=>Effect.gen(function*(){
      const services=yield* backend.servicesForRun(result.runId,stateRoot,format);
      return yield* Effect.gen(function*(){
        const binding=yield* readPelExecutionBinding(result.runId);
        if(binding.resultContract.classification!=='delivery-v1')return null;
        const delivery=yield* projectPelDeliveryResult(result,{binding});
        return format==='json'?formatPelDeliveryResultJson(delivery):formatPelDeliveryResultText(delivery,ref=>join(binding.stateRoot,'runs',binding.runId,'artifacts',ref.artifactId));
      }).pipe(Effect.mapError(failure),Effect.provide(services));
    }),
    configuredSnapshot:(base,explicit)=>Effect.gen(function*(){
      const loaded=yield* backend.configured();if(!loaded)return base;
      const effective=configurePelSnapshot(loaded.baseSnapshot,loaded.project);
      if(!effective.ok||explicit&&base.snapshotDigest!==effective.value.snapshotDigest)return yield* Effect.fail(authoringFailure('binding-mismatch','The supplied context differs from the configured project snapshot.'));
      return effective.value;
    }),
    run:input=>Effect.gen(function*(){
      const loaded=yield* backend.load(input.stateRoot),effective=configurePelSnapshot(loaded.baseSnapshot,loaded.project);
      if(!effective.ok)return yield* Effect.fail(authoringFailure('binding-mismatch','The project snapshot cannot be configured within its original bounds.'));
      if(input.context){const text=yield* Effect.try({try:()=>new TextDecoder('utf-8',{fatal:true}).decode(input.context),catch:()=>authoringFailure('binding-mismatch','Explicit context is not valid UTF-8.')});const parsed=parseAuthoringSnapshotV1(text);if(!parsed.ok||parsed.value.snapshotDigest!==effective.value.snapshotDigest)return yield* Effect.fail(authoringFailure('binding-mismatch','Explicit run context differs from project configuration.'));}
      const checked=yield* checkedSource(input.source,effective.value);
      yield* backend.preflight(checked,loaded);
      const override=input.binding?decodePelContractJson(input.binding,decodeExecutionBindingV1):null;
      if(override&&!override.ok)return yield* Effect.fail(authoringFailure('binding-mismatch','Explicit run binding is invalid.'));
      const runId=override?.ok?override.value.runId:`pel-${randomUUID()}` as RunId;
      const attempt:AttemptIdentity=override?.ok?override.value.attempt:{runId,laneId:'pel' as LaneId,attemptId:1 as AttemptIdentity['attemptId']};
      const contents={source:input.source,snapshot:bytes(checked.snapshot),registry:bytes(checked.snapshot.registry),configuration:bytes(loaded.project)};
      const artifacts={source:reference(contents.source),snapshot:reference(contents.snapshot),registry:reference(contents.registry),configuration:reference(contents.configuration)};
      const now=yield* backend.now;
      const derived=deriveExecutionBinding(loaded.project,checked,loaded.authority,{attempt,evidenceKind:backend.evidenceKind,runtimeVersion:backend.runtimeVersion,ownerLeaseRef:`lease:${runId}`,artifacts},now);
      if(!derived.ok)return yield* Effect.fail(authoringFailure('binding-mismatch',`Run admission failed at ${derived.error.fieldPath}.`));
      const binding=derived.value.binding;
      for(const retained of loaded.retainedInputs)if(hashAuthoringContent(reference(retained.bytes))!==hashAuthoringContent(retained.ref))return yield* Effect.fail(authoringFailure('binding-mismatch','A retained authority input differs from its validated reference.'));
      if(override?.ok&&hashAuthoringContent(override.value)!==hashAuthoringContent(binding))return yield* Effect.fail(authoringFailure('binding-mismatch','Explicit binding expands or changes the derived run.'));
      return yield* withPelRunOwner(binding,owner=>Effect.gen(function*(){
        const journal=yield* RunJournal,runtime=yield* PelRuntime;
        if((yield* readPelRecords(runId)).length)return yield* Effect.fail(pelFailure('binding-mismatch','This run ID already has durable history.'));
        const allocated=yield* journal.allocate(runId,attempt.laneId).pipe(Effect.mapError(()=>pelFailure('journal-write-failed','The run attempt could not be allocated.')));
        if(hashAuthoringContent(allocated)!==hashAuthoringContent(attempt))return yield* Effect.fail(pelFailure('binding-mismatch','Allocated attempt differs from admission.'));
        for(const retained of loaded.retainedInputs)yield* runtime.artifacts.put(runId,retained.bytes,PEL_MAX_ARTIFACT_BYTES,'ordinary');
        for(const [key,value] of Object.entries(contents)){
          const ref=yield* runtime.artifacts.put(runId,value,PEL_MAX_ARTIFACT_BYTES,'ordinary');
          if(hashAuthoringContent(ref)!==hashAuthoringContent(artifacts[key as keyof typeof artifacts]))return yield* Effect.fail(pelFailure('binding-mismatch','Stored admission artifact differs from its source.'));
        }
        const bindingRef=yield* runtime.artifacts.put(runId,bytes(binding),PEL_MAX_ARTIFACT_BYTES,'ordinary');
        const context=yield* runtime.loadRunInputs(binding);
        yield* appendPelRecord(binding,'pel.run.v1',{bindingRef});
        yield* input.started(runId).pipe(Effect.mapError(()=>pelFailure('journal-write-failed','The run ID could not be written to the operator stream.')));
        return yield* drivePelRun({kind:'fresh',checked,binding},{...context,owner});
      })).pipe(Effect.mapError(failure),Effect.provide(backend.services(loaded,input.outputMode)));
    }),
    resume:input=>Effect.gen(function*(){
      const services=yield* backend.servicesForRun(input.runId,input.stateRoot,input.outputMode);
      let options:PelResumeOptionsV1={};
      let unsigned:unknown;
      if(input.decision){const parsed=yield* parsePelInputJson(input.decision).pipe(Effect.mapError(failure));if(parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed)&&!Object.hasOwn(parsed,'authorityReceipt'))unsigned=parsed;}
      if(unsigned!==undefined){
        if(!backend.registerOperatorDecision)return yield* Effect.fail(authoringFailure('binding-mismatch','This host has no operator decision registration service.'));
      }else if(input.revision){
        const decision=input.decision?decodePelContractJson(input.decision,decodePelRevisionDecisionV1):null;
        if(!decision?.ok)return yield* Effect.fail(authoringFailure('binding-mismatch','The source revision requires a valid bound decision.'));
        options={revision:{source:input.revision,decision:decision.value}};
      }else if(input.decision){
        const decision=decodePelContractJson(input.decision,decodePelRecoveryDecisionV1);
        if(!decision.ok)return yield* Effect.fail(authoringFailure('binding-mismatch','The recovery decision is invalid.'));
        options={decision:decision.value};
      }
      return yield* Effect.gen(function*(){
        const binding=yield* readPelExecutionBinding(input.runId),runtime=yield* PelRuntime;
        return yield* withPelRunOwner(binding,owner=>Effect.gen(function*(){
          const context=yield* runtime.loadRunInputs(binding);
          if(unsigned!==undefined){
            const registered=yield* backend.registerOperatorDecision!({...context,owner},input.revision?'revision':'recovery',unsigned,input.revision);
            if(input.revision){const valid=decodePelRevisionDecisionV1(registered);if(!valid.ok)return yield* Effect.fail(pelFailure('binding-mismatch','The host returned an invalid registered revision decision.'));options={revision:{source:input.revision,decision:valid.value}};}
            else{const valid=decodePelRecoveryDecisionV1(registered);if(!valid.ok)return yield* Effect.fail(pelFailure('binding-mismatch','The host returned an invalid registered recovery decision.'));options={decision:valid.value};}
          }
          yield* input.started(input.runId).pipe(Effect.mapError(()=>pelFailure('journal-write-failed','The run ID could not be written.')));
          return yield* resumeProgram(input.runId,{...context,owner},options);
        }));
      }).pipe(Effect.mapError(failure),Effect.provide(services));
    }),
    status:(runId,stateRoot)=>Effect.gen(function*(){const services=yield* backend.servicesForRun(runId,stateRoot);return yield* pelStatus(runId).pipe(Effect.mapError(failure),Effect.provide(services));}),
    cancel:(runId,stateRoot)=>Effect.gen(function*(){const services=yield* backend.servicesForRun(runId,stateRoot);return yield* cancelPelRun(runId).pipe(Effect.mapError(failure),Effect.provide(services));}),
  };
}
