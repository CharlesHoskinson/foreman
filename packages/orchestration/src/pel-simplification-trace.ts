/** Exact rendered bytes from one fixed standard-start path. This is evidence, never a workflow. */
import {canonicalize,sha256Hex} from '@foreman/core';
import type {MetricFile} from './pel-simplification.js';
export const standardStartCommands=[['--version','--json'],['providers','list','--json'],['check','implement-verify-review.pel'],['plan','implement-verify-review.pel'],['run','implement-verify-review.pel','--json']] as const;
const channels=['grok-system-override','grok-output-schema','grok-session-prompt'] as const;
export interface StartupOperationalMetricsV1 {readonly commandsAfterPrerequisites:number|null;readonly startCommands:number|null;readonly entryPoints:number|null;readonly workflowLoops:number|null;readonly providerConditionals:number|null;readonly activeControlOwners:number|null;readonly authoritativeHistories:number|null;}
export const unknownStartupOperations:StartupOperationalMetricsV1={commandsAfterPrerequisites:null,startCommands:null,entryPoints:null,workflowLoops:null,providerConditionals:null,activeControlOwners:null,authoritativeHistories:null};
interface CommandObservation {readonly argv:readonly string[];readonly stdout:string;readonly stderr:string;readonly exitCode:number|null;}
interface InstructionObservation {readonly channel:typeof channels[number];readonly text:string;}
export interface PelStandardStartTraceV1 {
 readonly schemaVersion:1;readonly kind:'pel-standard-start-instructions-v1';readonly evidenceKind:'test-fixture'|'live-account';readonly candidateCommit:string;readonly sourceDigest:string;readonly workflowSha256:string;
 readonly commands:readonly (CommandObservation&{readonly stdoutSha256:string;readonly stderrSha256:string})[];
 readonly provider:{readonly profileId:'grok-4.6';readonly transportId:'grok-acp';readonly protocolVersion:string};
 readonly instructions:readonly (InstructionObservation&{readonly sha256:string})[];
 readonly boundary:'first-provider-prompt-sent';
}
export interface StartupTraceMeasurementV1 {readonly evidenceKind:PelStandardStartTraceV1['evidenceKind'];readonly sha256:string;readonly sourceDigest:string;readonly boundary:PelStandardStartTraceV1['boundary'];readonly operational:StartupOperationalMetricsV1;readonly renderedInstructions:readonly MetricFile[];}
export const traceSourceDigest=(files:readonly MetricFile[])=>sha256Hex(canonicalize([...files].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map(f=>({path:f.path,sha256:sha256Hex(f.bytes),byteLength:f.bytes.byteLength}))));
export function makeStandardStartTrace(input:{readonly candidateCommit:string;readonly candidateFiles:readonly MetricFile[];readonly evidenceKind:PelStandardStartTraceV1['evidenceKind'];readonly commands:readonly CommandObservation[];readonly provider:PelStandardStartTraceV1['provider'];readonly instructions:readonly InstructionObservation[]}):PelStandardStartTraceV1 {
 const workflow=input.candidateFiles.find(f=>f.path==='examples/pel/implement-verify-review.pel');if(!workflow)throw Error('The exact standard example is missing.');
 return {schemaVersion:1,kind:'pel-standard-start-instructions-v1',evidenceKind:input.evidenceKind,candidateCommit:input.candidateCommit,sourceDigest:traceSourceDigest(input.candidateFiles),workflowSha256:sha256Hex(workflow.bytes),commands:input.commands.map(r=>({...r,stdoutSha256:sha256Hex(r.stdout),stderrSha256:sha256Hex(r.stderr)})),provider:input.provider,instructions:input.instructions.map(r=>({...r,sha256:sha256Hex(r.text)})),boundary:'first-provider-prompt-sent'};
}
const object=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:Record<string,unknown>,names:readonly string[])=>Object.keys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k));
const text=(x:unknown,max:number):x is string=>typeof x==='string'&&x.isWellFormed()&&!x.includes('\0')&&Buffer.byteLength(x)<=max;
export function validateStandardStartTrace(value:unknown,candidateCommit:string,files:readonly MetricFile[]):{readonly ok:true;readonly value:StartupTraceMeasurementV1}|{readonly ok:false;readonly error:string} {
 const bad=()=>({ok:false as const,error:'The startup trace is incomplete, changed, or does not match the exact candidate and fixed standard-start path.'});
 try{
 if(!object(value)||!keys(value,['schemaVersion','kind','evidenceKind','candidateCommit','sourceDigest','workflowSha256','commands','provider','instructions','boundary'])||value.schemaVersion!==1||value.kind!=='pel-standard-start-instructions-v1'||!['test-fixture','live-account'].includes(String(value.evidenceKind))||value.candidateCommit!==candidateCommit||!/^[a-f0-9]{40}$/u.test(candidateCommit)||value.sourceDigest!==traceSourceDigest(files)||value.boundary!=='first-provider-prompt-sent')return bad();
 const workflow=files.find(f=>f.path==='examples/pel/implement-verify-review.pel');if(!workflow||sha256Hex(workflow.bytes)!==value.workflowSha256)return bad();
 if(!Array.isArray(value.commands)||value.commands.length!==standardStartCommands.length||!Array.isArray(value.instructions)||value.instructions.length!==channels.length)return bad();
 if(!object(value.provider)||!keys(value.provider,['profileId','transportId','protocolVersion'])||value.provider.profileId!=='grok-4.6'||value.provider.transportId!=='grok-acp'||!text(value.provider.protocolVersion,128)||!value.provider.protocolVersion)return bad();
 const renderedInstructions:MetricFile[]=[];
 for(const [index,row]of value.commands.entries()){
  if(!object(row)||!keys(row,['argv','stdout','stderr','exitCode','stdoutSha256','stderrSha256'])||canonicalize(row.argv)!==canonicalize(standardStartCommands[index])||row.exitCode!==(index===4?null:0)||!text(row.stdout,1024*1024)||!text(row.stderr,1024*1024)||row.stdoutSha256!==sha256Hex(row.stdout)||row.stderrSha256!==sha256Hex(row.stderr)||index===4&&row.stdout!=='')return bad();
  // Run-start status contains an allocated run ID, not orchestration instructions.
  for(const stream of ['stdout','stderr'] as const)if(index<4&&row[stream])renderedInstructions.push({path:`startup-trace/${index}-${stream}.txt`,bytes:Buffer.from(row[stream] as string)});
 }
 for(const [index,row]of value.instructions.entries()){
  if(!object(row)||!keys(row,['channel','text','sha256'])||row.channel!==channels[index]||!text(row.text,2*1024*1024)||row.text.length===0||row.sha256!==sha256Hex(row.text))return bad();
  renderedInstructions.push({path:`startup-trace/provider-${index}-${row.channel}.txt`,bytes:Buffer.from(row.text)});
 }
 if(renderedInstructions.reduce((n,f)=>n+f.bytes.byteLength,0)>8*1024*1024)return bad();
 return {ok:true,value:{evidenceKind:value.evidenceKind as PelStandardStartTraceV1['evidenceKind'],sha256:sha256Hex(canonicalize(value)),sourceDigest:String(value.sourceDigest),boundary:'first-provider-prompt-sent',renderedInstructions,operational:{...unknownStartupOperations,commandsAfterPrerequisites:3,startCommands:1,entryPoints:1}}};
 }catch{return bad();}
}
