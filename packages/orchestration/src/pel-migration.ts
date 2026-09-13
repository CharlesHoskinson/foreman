/** Closed legacy import. This module does not execute argv, acquire ownership, or change a journal. */
import {Either,Effect} from 'effect';
import {canonicalize,sha256Hex,parseJsonRejectDuplicateKeys,isCoreFailure} from '@foreman/core';
import {RunJournal,type RunId,type LaneId,type StoredEvent} from '@foreman/event-log';
import {decodeRoundPlanV1,isRoundContractFailure} from './round-contract.js';
import {decodeExecutionContractV1,isExecutionContractFailure,executionContractSha256,type ExecutionLimitsV1} from './execution-contract.js';
import {selectLatestRoundAttempt} from './resume-decision.js';
import {recoverRoundAttempt} from './round-reducer.js';
import {pelMigrationSources} from './pel-migration-sources.js';

export type PelMigrationTemplateV1=keyof typeof pelMigrationSources;
export interface MigrationDiagnostic {readonly code:'UnsupportedLegacyConstruct'|'ActiveLegacyRun'|'MigrationIO';readonly exitCode:1|2|3;readonly locator:string;readonly field:string;readonly message:string;readonly owner?:PelLegacyRunObservationV1['owner'];readonly originalController?:'unavailable';}
export interface PelLegacyRunObservationV1 {readonly runId:string;readonly stateRoot?:string;readonly state:'absent'|'terminal'|'active'|'unknown';readonly historySha256:string;readonly owner:{readonly controller:'legacy-round';readonly laneId:string;readonly attemptId:number;readonly ownershipSequence:number|null}|null;}
export interface PelLegacyCommandBindingV1 {
 readonly schemaVersion:1;readonly kind:'foreman.legacy-command-binding.v1';readonly template:PelMigrationTemplateV1;readonly contractSha256:string;
 readonly commandArgv:readonly (string|{readonly placeholder:'promptPath'|'workspaceRoot';readonly type:'path'})[];
 readonly values:{readonly promptPath:string;readonly workspaceRoot:string};readonly input:{readonly artifactId:'artifact:approved-spec';readonly sha256:string};
 readonly workspace:{readonly grantId:string;readonly immutableBase:string;readonly writablePaths:readonly string[]};
 readonly implementer:{readonly profileId:'grok-4.6';readonly transportId:'grok-acp';readonly credentialProfileRef:string};
 readonly reviewer:{readonly profileId:'gpt-5.6-sol';readonly transportId:'codex-app-server';readonly credentialProfileRef:string};
 readonly gate:{readonly id:'candidate-full';readonly legacyCommand:string;readonly argv:readonly string[];readonly argvSha256:string};
 readonly report:{readonly path:string;readonly baseline:'absent'};readonly correctionLimit:0|1;readonly publication:'disabled';
}
export interface MigratedPelV1 {readonly schemaVersion:1;readonly source:string;readonly sourceSha256:string;readonly origin:{readonly format:'RoundPlanV1+ExecutionContractV1';readonly version:1;readonly roundSha256:string;readonly contractFileSha256:string};readonly parityReport:{readonly template:PelMigrationTemplateV1;readonly bindingSha256:string;readonly contractSha256:string;readonly runId:string;readonly laneId:string;readonly attemptId:number;readonly limits:ExecutionLimitsV1;readonly requiredMilestones:readonly string[];readonly implementer:PelLegacyCommandBindingV1['implementer'];readonly reviewer:PelLegacyCommandBindingV1['reviewer'];readonly workspace:PelLegacyCommandBindingV1['workspace'];readonly gate:PelLegacyCommandBindingV1['gate'];readonly input:PelLegacyCommandBindingV1['input'];readonly correctionLimit:number;readonly publication:'disabled';readonly historicalEventsRewritten:false;};}
export interface PelMigrationInputV1 {readonly round:{readonly locator:string;readonly bytes:Uint8Array};readonly contract:{readonly locator:string;readonly bytes:Uint8Array};readonly bindings:readonly PelLegacyCommandBindingV1[];readonly legacyState:PelLegacyRunObservationV1;}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const path=(v:unknown):v is string=>text(v)&&!v.split(/[\\/]/u).includes('..');
const unsupported=(locator:string,field:string,message:string):MigrationDiagnostic=>({code:'UnsupportedLegacyConstruct',exitCode:2,locator,field,message});
const hash=(v:unknown)=>sha256Hex(canonicalize(v));
function parse(input:{locator:string;bytes:Uint8Array}):Either.Either<unknown,MigrationDiagnostic>{
 try{if(input.bytes.byteLength>1048576)return Either.left(unsupported(input.locator,'$','Legacy input exceeds its byte bound.'));const value=parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes));return isCoreFailure(value)?Either.left(unsupported(input.locator,'$','Legacy input is not duplicate-free JSON.')):Either.right(value);}catch{return Either.left(unsupported(input.locator,'$','Legacy input is not bounded UTF-8 JSON.'));}
}
export function decodePelLegacyCommandBindingV1(value:unknown):Either.Either<PelLegacyCommandBindingV1,MigrationDiagnostic>{
 const bad=()=>Either.left(unsupported('registered-command-bindings','$','The trusted command binding is not a supported closed template.'));
 if(!exact(value,['schemaVersion','kind','template','contractSha256','commandArgv','values','input','workspace','implementer','reviewer','gate','report','correctionLimit','publication'])||value.schemaVersion!==1||value.kind!=='foreman.legacy-command-binding.v1'||!['implement-verify-review','bounded-rework'].includes(String(value.template))||!digest(value.contractSha256)||value.publication!=='disabled'||value.correctionLimit!==(value.template==='bounded-rework'?1:0))return bad();
 if(!exact(value.values,['promptPath','workspaceRoot'])||!path(value.values.promptPath)||!path(value.values.workspaceRoot)||!exact(value.input,['artifactId','sha256'])||value.input.artifactId!=='artifact:approved-spec'||!digest(value.input.sha256))return bad();
 if(!exact(value.workspace,['grantId','immutableBase','writablePaths'])||!text(value.workspace.grantId)||typeof value.workspace.immutableBase!=='string'||!/^[a-f0-9]{40}$/u.test(value.workspace.immutableBase)||!Array.isArray(value.workspace.writablePaths)||value.workspace.writablePaths.length===0||value.workspace.writablePaths.length>64||!value.workspace.writablePaths.every(path))return bad();
 if(!exact(value.implementer,['profileId','transportId','credentialProfileRef'])||value.implementer.profileId!=='grok-4.6'||value.implementer.transportId!=='grok-acp'||!text(value.implementer.credentialProfileRef)||!exact(value.reviewer,['profileId','transportId','credentialProfileRef'])||value.reviewer.profileId!=='gpt-5.6-sol'||value.reviewer.transportId!=='codex-app-server'||!text(value.reviewer.credentialProfileRef))return bad();
 if(!exact(value.gate,['id','legacyCommand','argv','argvSha256'])||value.gate.id!=='candidate-full'||!text(value.gate.legacyCommand)||!Array.isArray(value.gate.argv)||value.gate.argv.length===0||value.gate.argv.length>64||!value.gate.argv.every(text)||value.gate.argvSha256!==hash(value.gate.argv)||!exact(value.report,['path','baseline'])||!path(value.report.path)||value.report.baseline!=='absent')return bad();
 const template=['grok','--prompt-file',{placeholder:'promptPath',type:'path'},'-m','grok-4.6','--allow','Write','--allow','Edit','--output-format','plain','--cwd',{placeholder:'workspaceRoot',type:'path'},'--no-leader'];
 if(hash(value.commandArgv)!==hash(template))return bad();
 return Either.right(structuredClone(value) as unknown as PelLegacyCommandBindingV1);
}

/** Existing round selection/recovery is the only authority for legacy terminal history. */
export function observePelLegacyRun(runId:string,events:readonly StoredEvent[]):PelLegacyRunObservationV1{
 const historySha256=hash(events);if(events.length===0)return {runId,state:'absent',historySha256,owner:null};
 // Keep the full history hash; the existing round reducer excludes only resume accounting.
 const roundEvents=events.filter(e=>e.type!=='resume_attempt');
 const lanes=[...new Set(roundEvents.filter(e=>e.type==='prompt').map(e=>e.lane))];if(lanes.length===0||events.some(e=>e.type.startsWith('pel.')))return {runId,state:'unknown',historySha256,owner:null};
 for(const lane of lanes){const selected=selectLatestRoundAttempt(roundEvents,runId as RunId,lane as LaneId);if(selected._tag!=='Selected')return {runId,state:'unknown',historySha256,owner:null};const recovered=recoverRoundAttempt(roundEvents,selected.attemptIdentity);if(recovered._tag!=='Completed')return {runId,state:'active',historySha256,owner:{controller:'legacy-round',laneId:lane,attemptId:selected.attemptIdentity.attemptId,ownershipSequence:events.filter(e=>e.type==='ownership'&&e.lane===lane&&e.payload.attempt===selected.attemptIdentity.attemptId).at(-1)?.seq??null}};}
 return {runId,state:'terminal',historySha256,owner:null};
}
export function readPelLegacyRunObservation(runId:RunId):Effect.Effect<PelLegacyRunObservationV1,MigrationDiagnostic,RunJournal>{return Effect.gen(function*(){const journal=yield* RunJournal;return yield* journal.transact(runId,events=>({_tag:'Return',value:observePelLegacyRun(runId,events)})).pipe(Effect.mapError(()=>({code:'MigrationIO' as const,exitCode:1 as const,locator:runId,field:'history',message:'The original legacy history could not be read.'})));});}

export function importLegacyWorkflow(input:PelMigrationInputV1):Either.Either<MigratedPelV1,MigrationDiagnostic>{
 const rawRound=parse(input.round);if(Either.isLeft(rawRound))return Either.left(rawRound.left);const rawContract=parse(input.contract);if(Either.isLeft(rawContract))return Either.left(rawContract.left);
 for(const [raw,source,keys] of [[rawRound.right,input.round,['schemaVersion','runId','laneId','attemptId','mode','commandArgv','gateCommand','reportPath','reportBaseline']],[rawContract.right,input.contract,['schemaVersion','contractId','packageId','objectiveSha256','acceptanceSha256','baseCommit','allowedPathsSha256','dependencyContractIds','authorizationSha256','createdAt','deadlineAt','limits','requiredMilestones','supersedesContractId']]] as const){if(!object(raw))return Either.left(unsupported(source.locator,'$','Expected a legacy record.'));const unknown=Object.keys(raw).find(key=>!(keys as readonly string[]).includes(key));if(unknown)return Either.left(unsupported(source.locator,`$.${unknown}`,'The field has no registered migration.'));if(raw.schemaVersion!==1)return Either.left(unsupported(source.locator,'$.schemaVersion','Only schema version 1 is supported.'));}
 const round=decodeRoundPlanV1(rawRound.right);if(isRoundContractFailure(round))return Either.left(unsupported(input.round.locator,'$','RoundPlanV1 decoding failed.'));const contract=decodeExecutionContractV1(rawContract.right);if(isExecutionContractFailure(contract))return Either.left(unsupported(input.contract.locator,'$','ExecutionContractV1 decoding failed.'));
 if(input.legacyState.runId!==round.runId)return Either.left(unsupported(input.round.locator,'$.runId','The legacy owner observation belongs to another run.'));
 if(input.legacyState.state==='active'||input.legacyState.state==='unknown')return Either.left({code:'ActiveLegacyRun',exitCode:3,locator:input.round.locator,field:'$.runId',message:'The legacy run retains its original controller and state. The recorded history does not identify a verified original controller executable; this runtime cannot restart it.',owner:input.legacyState.owner,originalController:'unavailable'});
 if(input.bindings.length>16)return Either.left(unsupported('registered-command-bindings','$','Too many registered bindings.'));
 const candidates:PelLegacyCommandBindingV1[]=[];for(const value of input.bindings){const decoded=decodePelLegacyCommandBindingV1(value);if(Either.isLeft(decoded))return Either.left(decoded.left);const b=decoded.right,argv=b.commandArgv.map(a=>typeof a==='string'?a:b.values[a.placeholder]);if(hash(argv)===hash(round.commandArgv))candidates.push(b);}
 if(candidates.length!==1)return Either.left(unsupported(input.round.locator,'$.commandArgv[0]','The exact command vector has no unique registered template.'));
 const binding=candidates[0]!;
 if(round.gateCommand!==binding.gate.legacyCommand)return Either.left(unsupported(input.round.locator,'$.gateCommand','The gate is not the registered argv digest.'));
 if(round.reportPath!==binding.report.path||round.reportBaseline._tag!=='Absent')return Either.left(unsupported(input.round.locator,'$.reportPath','The report path or baseline has no registered mapping.'));
 if(executionContractSha256(contract)!==binding.contractSha256)return Either.left(unsupported(input.contract.locator,'$','The contract does not match the registered template authority.'));
 if(contract.baseCommit!==binding.workspace.immutableBase||contract.allowedPathsSha256!==sha256Hex(canonicalize({schema:'foreman.execution-paths.v1',allowedPaths:[...binding.workspace.writablePaths].sort()})+'\n')||contract.dependencyContractIds.length!==0||hash(contract.requiredMilestones)!==hash(['checks','audit'])||binding.correctionLimit>contract.limits.correctionRounds)return Either.left(unsupported(input.contract.locator,'$','The original candidate, scope, or bounds differ from the registered workflow.'));
 const source=pelMigrationSources[binding.template];return Either.right({schemaVersion:1,source,sourceSha256:sha256Hex(source),origin:{format:'RoundPlanV1+ExecutionContractV1',version:1,roundSha256:sha256Hex(input.round.bytes),contractFileSha256:sha256Hex(input.contract.bytes)},parityReport:{template:binding.template,bindingSha256:hash(binding),contractSha256:executionContractSha256(contract),runId:round.runId,laneId:round.laneId,attemptId:round.attemptId,limits:contract.limits,requiredMilestones:contract.requiredMilestones,implementer:binding.implementer,reviewer:binding.reviewer,workspace:binding.workspace,gate:binding.gate,input:binding.input,correctionLimit:binding.correctionLimit,publication:'disabled',historicalEventsRewritten:false}});
}
