#!/usr/bin/env node
import {basename,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Effect} from 'effect';
import {collectSimplification,type MetricCollectionFailure} from './pel-simplification-live.js';
import type {SimplificationResultV1} from './pel-simplification.js';
import {commandExitCode} from './pel-provider-cli.js';
interface MetricMainPorts {readonly collect:typeof collectSimplification;readonly write:(text:string)=>Effect.Effect<void,MetricCollectionFailure>;}
const output=(text:string)=>Effect.async<void,MetricCollectionFailure>(resume=>{process.stdout.write(text,error=>resume(error?Effect.fail({_tag:'MetricCollectionFailure',code:'MetricCollectionFailed',message:'The metric output could not be written.',exitCode:1}):Effect.void));});
export function runPelSimplificationMain(argv:readonly string[],overrides:Partial<MetricMainPorts>={}){return Effect.gen(function*(){
 const ports:MetricMainPorts={collect:collectSimplification,write:output,...overrides};
 const invalid=():MetricCollectionFailure=>({_tag:'MetricCollectionFailure',code:'MetricInputInvalid',message:'Use --baseline FILE --candidate EXACT_COMMIT [--repo DIRECTORY] [--startup-trace FILE].',exitCode:2});
 const run=Effect.gen(function*(){
  const flags=new Map<string,string>();for(let i=0;i<argv.length;i+=2){const key=argv[i]!,value=argv[i+1];if(!['--baseline','--candidate','--repo','--startup-trace'].includes(key)||flags.has(key)||!value||value.startsWith('--')||value.includes('\0'))return yield* Effect.fail(invalid());flags.set(key,value);}
  if(!flags.has('--baseline')||!flags.has('--candidate')||!/^[a-f0-9]{40}$/u.test(flags.get('--candidate')!))return yield* Effect.fail(invalid());
  const report:SimplificationResultV1=yield* ports.collect({repositoryRoot:resolve(flags.get('--repo')??process.cwd()),baselinePath:resolve(flags.get('--baseline')!),candidateCommit:flags.get('--candidate')!,...(flags.has('--startup-trace')?{startupTracePath:resolve(flags.get('--startup-trace')!)}:{})});
  yield* ports.write(JSON.stringify(report,null,2)+'\n');return commandExitCode('simplification',report.exitCode===0?'success':'failed');
 });
 return yield* run.pipe(Effect.catchAll(error=>ports.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n').pipe(Effect.as(error.exitCode),Effect.catchAll(()=>Effect.succeed(1 as const)))));
});}
if(process.argv[1]&&basename(fileURLToPath(import.meta.url))==='pel-simplification.js'&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);
 try{process.exitCode=await Effect.runPromise(runPelSimplificationMain(process.argv.slice(2)),{signal:controller.signal});}catch{process.exitCode=controller.signal.aborted?4:1;}finally{process.removeListener('SIGINT',cancel);}
}
