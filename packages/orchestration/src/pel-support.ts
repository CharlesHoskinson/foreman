/** Closed support projection. Raw prompts, credentials, errors, and reasoning are never traversed. */
import {canonicalize} from '@foreman/core';
import {resolveProfile} from '@foreman/providers';
import type {StoredEvent} from '@foreman/event-log';
import {runFailureCodes,hostEffectFailureCodes} from './pel-run-contract.js';
import type {InstallManifestV1} from './pel-package.js';
export type PelPackageIdentityV1=Pick<InstallManifestV1,'releaseName'|'version'|'buildId'>;
export type PelSupportEvidenceKindV1='product'|'test-fixture'|'unknown';
export interface PelSupportInputV1 {readonly evidenceKind?:PelSupportEvidenceKindV1;readonly version:PelPackageIdentityV1;readonly platform:{readonly platform:string;readonly arch:string;readonly nodeVersion:string};readonly runId:string;readonly events:readonly StoredEvent[];readonly result:unknown;}
export interface PelSupportBundleV1 {
 readonly schemaVersion:1;readonly evidenceKind:PelSupportEvidenceKindV1;readonly version:PelPackageIdentityV1;readonly platform:PelSupportInputV1['platform'];readonly runId:string;
 readonly providers:readonly {readonly provider:string;readonly profileId:string;readonly transportId:string;readonly model:string|null;readonly protocolVersion:string|null}[];
 readonly failures:readonly string[];readonly eventIds:readonly number[];readonly reproductionCommand:string;
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const providerCodes=['ModelUnavailable','ModelMismatch','UnsupportedCapability','CapabilityUnverified','PromptChannelUnsupported','AuthenticationRequired','ProbeUnknown','OutputInvalid','OutputIncomplete','MalformedEvent','ContinuationMismatch','ResumeUnavailable','OutcomeUnknown','RateLimited','TransportDisconnected'];
const safeCodes=new Set<string>([...runFailureCodes,...hostEffectFailureCodes,...providerCodes]);
export function projectPelSupportBundle(input:PelSupportInputV1):PelSupportBundleV1 {
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.runId)||input.events.length>100000)throw Error('Invalid support input');
 const providers=new Map<string,PelSupportBundleV1['providers'][number]>(),failures=new Set<string>(),eventIds:number[]=[];
 const code=(value:unknown)=>{if(typeof value==='string'&&safeCodes.has(value))failures.add(value);};
 for(const event of input.events){if(!Number.isSafeInteger(event.seq)||event.seq<0)continue;eventIds.push(event.seq);const data=object(event.payload.data)?event.payload.data:undefined;if(!data)continue;
  const identity=data.providerIdentity;if(object(identity)&&typeof identity.profileId==='string'){const profile=resolveProfile(identity.profileId);if(profile.ok&&identity.provider===profile.value.provider&&typeof identity.transportId==='string'&&profile.value.transports.some(t=>t===identity.transportId)){const row={provider:profile.value.provider,profileId:profile.value.id,transportId:identity.transportId,model:identity.model===profile.value.exactModel?profile.value.exactModel:null,protocolVersion:typeof identity.protocolVersion==='string'&&/^(?:v?\d+(?:\.\d+){0,3}(?:\/v\d+)?|v1beta|\d{4}-\d{2}-\d{2}|fixture-v1)$/.test(identity.protocolVersion)?identity.protocolVersion:null};providers.set(canonicalize(row),row);}}
  code(data.code);if(object(data.failure))code(data.failure._tag);
 }
 if(object(input.result)&&Array.isArray(input.result.diagnostics))for(const diagnostic of input.result.diagnostics.slice(0,1000)){if(!object(diagnostic))continue;code(diagnostic.code);if(object(diagnostic.cause)&&object(diagnostic.cause.providerFailure))code(diagnostic.cause.providerFailure._tag);}
 const platform={platform:['linux','darwin','win32','freebsd'].includes(input.platform.platform)?input.platform.platform:'unknown',arch:['x64','arm64','ia32','arm'].includes(input.platform.arch)?input.platform.arch:'unknown',nodeVersion:/^\d+\.\d+\.\d+$/.test(input.platform.nodeVersion)?input.platform.nodeVersion:'unknown'};
 return {schemaVersion:1,evidenceKind:input.evidenceKind==='product'||input.evidenceKind==='test-fixture'?input.evidenceKind:'unknown',version:{releaseName:input.version.releaseName,version:input.version.version,buildId:input.version.buildId},platform,runId:input.runId,providers:[...providers].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row),failures:[...failures].sort(),eventIds:[...new Set(eventIds)].sort((a,b)=>a-b),reproductionCommand:`foreman status ${input.runId} --json`};
}
