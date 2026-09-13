/** Restore original run inputs. Current settings and working source are not recovery inputs. */
import {Effect} from 'effect';
import {checkPel,canonicalAuthoringJson,validateAuthoringSnapshotV1,hashAuthoringContent} from '@foreman/pel';
import {parseJsonRejectDuplicateKeys,isCoreFailure} from '@foreman/core';
import {executionContractSha256,type ExecutionContractV1} from './execution-contract.js';
import {configurePelSnapshot,decodeForemanProjectV1,type PelValidatedAuthorityV1} from './pel-project-config.js';
import {decodeExecutionBindingV1,type ExecutionBindingV1,type PelArtifactPort,type PelArtifactRefV1,type PelOwnedRunContextV1,type RunFailure} from './pel-run-contract.js';
import {pelFailure} from './pel-journal.js';

export interface PelImmutableInputOptions {
  readonly artifacts:PelArtifactPort;
  readonly runtimeVersion:string;
  readonly runtimeHandlerVersion:string;
  readonly registryDigest:string;
  readonly resolveAuthority:(project:import('./pel-run-contract.js').ForemanProjectV1,read:(ref:PelArtifactRefV1,max:number)=>Effect.Effect<Uint8Array,RunFailure>)=>Effect.Effect<PelValidatedAuthorityV1,RunFailure>;
}
export function parsePelInputJson(bytes:Uint8Array):Effect.Effect<unknown,RunFailure>{return Effect.try({try:()=>{
  const parsed=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(isCoreFailure(parsed))throw Error('json');return parsed;
},catch:()=>pelFailure('binding-mismatch','An immutable input is invalid JSON.')});}
export function loadImmutablePelRunInputs(binding:ExecutionBindingV1,options:PelImmutableInputOptions):Effect.Effect<Omit<PelOwnedRunContextV1,'owner'>,RunFailure>{
  return Effect.gen(function*(){
    if(!decodeExecutionBindingV1(binding).ok||binding.runtimeVersion!==options.runtimeVersion||binding.runtimeHandlerVersion!==options.runtimeHandlerVersion||binding.registryDigest!==options.registryDigest)return yield* Effect.fail(pelFailure('binding-mismatch','The runtime cannot execute this original binding.'));
    const read=(ref:PelArtifactRefV1,max:number)=>options.artifacts.get(binding.runId,ref,max);
    const source=yield* read(binding.artifacts.source,1048576);
    const project=decodeForemanProjectV1(yield* parsePelInputJson(yield* read(binding.artifacts.configuration,1048576)));
    const snapshot=validateAuthoringSnapshotV1(yield* parsePelInputJson(yield* read(binding.artifacts.snapshot,16777216)));
    const registry=yield* parsePelInputJson(yield* read(binding.artifacts.registry,16777216));
    if(!project.ok||!snapshot.ok||project.value.stateRoot!==binding.stateRoot||hashAuthoringContent(project.value.repository)!==hashAuthoringContent(binding.repository)||hashAuthoringContent(project.value)!==binding.configurationDigest||snapshot.value.snapshotDigest!==binding.snapshotDigest||snapshot.value.registryDigest!==binding.registryDigest||canonicalAuthoringJson(registry)!==canonicalAuthoringJson(snapshot.value.registry))return yield* Effect.fail(pelFailure('binding-mismatch','The original project, registry or snapshot differs from admission.'));
    const effective=configurePelSnapshot(snapshot.value,project.value);
    if(!effective.ok||effective.value.snapshotDigest!==binding.snapshotDigest)return yield* Effect.fail(pelFailure('binding-mismatch','The original effective snapshot differs from its project selections.'));
    const checked=checkPel({source,snapshot:snapshot.value});
    if(checked.tag!=='ok'||checked.checked.bindingDigest!==binding.checkedProgramDigest||checked.checked.sourceDigest!==binding.sourceDigest)return yield* Effect.fail(pelFailure('binding-mismatch','The original source does not reproduce its checked binding.'));
    const {deadline,...limits}=binding.limits;
    if(hashAuthoringContent(limits)!==hashAuthoringContent(project.value.limits)||hashAuthoringContent(binding.resultContract)!==hashAuthoringContent(project.value.resultContract)||hashAuthoringContent(binding.requiredMilestones)!==hashAuthoringContent(project.value.requiredMilestones)||binding.languageProfileId!==checked.checked.languageProfile.id||binding.languageProfileDigest!==checked.checked.languageProfile.digest||hashAuthoringContent({...binding.options,replay:{mode:'none'}})!==snapshot.value.optionsDigest)return yield* Effect.fail(pelFailure('binding-mismatch','Original limits, selections, language or result policy differ from the run binding.'));
    const authority=yield* options.resolveAuthority(project.value,read);
    const contract:ExecutionContractV1=authority.contract;
    if(contract.contractId!==binding.contractId||executionContractSha256(contract)!==binding.contractSha256||hashAuthoringContent(authority.binding)!==hashAuthoringContent(binding.authority)||!Number.isSafeInteger(authority.executionDeadline)||deadline>authority.executionDeadline)return yield* Effect.fail(pelFailure('binding-mismatch','Registered authority differs from the original run.'));
    const reachable=new Set([...checked.checked.analysis.effects.map(e=>e.registryId),...checked.checked.analysis.dynamicRegions.flatMap(r=>r.possibleRegistryIds)]);
    for(const id of reachable)if(!authority.availableHandlers.has(id))return yield* Effect.fail(pelFailure('binding-mismatch',`The original run requires unavailable handler ${id}.`));
    return {binding,project:project.value,contract,snapshot:snapshot.value,registry:snapshot.value.registry};
  });
}
