/** Read-only historical projection through the existing strict journal and round decoders. */
import {Effect} from 'effect';
import {decodeAttemptIdentity,decodeRunId,type AttemptIdentity,type LaneId,type RunId} from '@foreman/event-log';
import {TypedJournalReader} from './supervisor.js';
import {observePelLegacyRun} from './pel-migration.js';
import {selectLatestRoundAttempt} from './resume-decision.js';
import {authoringFailure,type AuthoringFailure} from './pel-authoring-contract.js';

export interface PelLegacyStatusV1 {
 readonly schemaVersion:1;
 readonly kind:'legacy-round';
 readonly runId:RunId;
 readonly state:'active'|'terminal'|'unknown';
 readonly historySha256:string;
 readonly attempts:readonly AttemptIdentity[];
 readonly originalController:'unavailable';
 readonly nextAction:string;
}
export function isPelLegacyStatusV1(value:unknown):value is PelLegacyStatusV1 {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>,keys=['schemaVersion','kind','runId','state','historySha256','attempts','originalController','nextAction'];
 return Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key))&&v.schemaVersion===1&&v.kind==='legacy-round'&&typeof v.runId==='string'&&typeof decodeRunId(v.runId)==='string'&&['active','terminal','unknown'].includes(String(v.state))&&typeof v.historySha256==='string'&&/^[a-f0-9]{64}$/u.test(v.historySha256)&&v.originalController==='unavailable'&&typeof v.nextAction==='string'&&v.nextAction.length<=1024&&Array.isArray(v.attempts)&&v.attempts.length<=1024&&v.attempts.every(a=>{if(a===null||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length!==3||typeof a.runId!=='string'||typeof a.laneId!=='string'||typeof a.attemptId!=='number')return false;const result=decodeAttemptIdentity(a.runId,a.laneId,a.attemptId);return 'runId'in result&&result.runId===v.runId;});
}
export function readPelLegacyStatus(runId:RunId):Effect.Effect<PelLegacyStatusV1|null,AuthoringFailure,TypedJournalReader> {
 return Effect.gen(function*(){
  const reader=yield* TypedJournalReader,read=yield* reader.readRun(runId);
  if(read._tag==='Missing')return yield* Effect.fail(authoringFailure('PEL_LEGACY_HISTORY','The selected run has no durable history.',2));
  if(read._tag==='Corrupt')return yield* Effect.fail(authoringFailure('PEL_LEGACY_HISTORY','The selected run history cannot be decoded.',1));
  const events=read.records.map(record=>record.event);
  if(events.some(event=>event.type==='pel.run.v1'))return null;
  const observed=observePelLegacyRun(runId,events),attempts:AttemptIdentity[]=[];
  for(const lane of new Set(events.filter(event=>event.type==='prompt').map(event=>event.lane))){const selected=selectLatestRoundAttempt(events,runId,lane as LaneId);if(selected._tag==='Selected')attempts.push(selected.attemptIdentity);}
  return {schemaVersion:1,kind:'legacy-round',runId,state:observed.state==='absent'?'unknown':observed.state,historySha256:observed.historySha256,attempts,originalController:'unavailable',nextAction:observed.state==='terminal'?'Retain the historical records. This status does not establish a Pel delivery result.':'Use the retained original controller. The history does not identify a verified controller executable; this runtime cannot restart legacy work.'};
 });
}
