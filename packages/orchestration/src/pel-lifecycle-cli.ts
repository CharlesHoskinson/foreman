/** Lifecycle parsing extends the one Foreman CLI. Services own durable execution. */
import {Effect} from 'effect';
import {decodeRunId, type RunId} from '@foreman/event-log';
import type {AuthoringSnapshotV1} from '@foreman/pel';
import {authoringFailure, type AuthoringFailure, type AuthoringServices, type CliResult} from './pel-authoring-contract.js';
import {decodeRunStatusV1,type RunResultV1,type RunStatusV1} from './pel-run-contract.js';
import {decodeRunResultV1} from './pel-run-result.js';

export interface PelLifecycleStartInput {
  readonly outputMode?:'text'|'json';
  readonly source:Uint8Array;
  readonly sourcePath:string;
  readonly stateRoot?:string;
  readonly binding?:Uint8Array;
  readonly context?:Uint8Array;
  readonly started:(runId:string)=>Effect.Effect<void,AuthoringFailure>;
}
export interface PelLifecycleResumeInput {
  readonly outputMode?:'text'|'json';
  readonly runId:RunId;
  readonly stateRoot?:string;
  readonly decision?:Uint8Array;
  readonly revision?:Uint8Array;
  readonly started:(runId:string)=>Effect.Effect<void,AuthoringFailure>;
}
export interface PelLifecycleCliServices {
  readonly run:(input:PelLifecycleStartInput)=>Effect.Effect<RunResultV1,AuthoringFailure>;
  readonly resume:(input:PelLifecycleResumeInput)=>Effect.Effect<RunResultV1,AuthoringFailure>;
  readonly status:(runId:RunId,stateRoot?:string)=>Effect.Effect<RunStatusV1|RunResultV1,AuthoringFailure>;
  readonly cancel:(runId:RunId,stateRoot?:string)=>Effect.Effect<RunStatusV1|RunResultV1,AuthoringFailure>;
  readonly configure:(bytes:Uint8Array)=>Effect.Effect<void,AuthoringFailure>;
  readonly configuredSnapshot?:(base:AuthoringSnapshotV1,explicit:boolean)=>Effect.Effect<AuthoringSnapshotV1,AuthoringFailure>;
}
export function pelLifecycleExit(status:RunStatusV1):CliResult['exitCode'] {
  switch(status.state){case 'succeeded':return 0;case 'failed':return 1;case 'needs-action':return 3;case 'cancelled':return 4;default:return 5;}
}
export function runPelLifecycleCli(argv:readonly string[],services:AuthoringServices):Effect.Effect<CliResult,AuthoringFailure> {
  const json=argv.includes('--json');
  return Effect.gen(function*(){
    const command=argv[0], lifecycle=services.lifecycle;
    const configure=command==='project'&&argv[1]==='configure';
    if(!lifecycle)return yield* Effect.fail(authoringFailure('binding-mismatch','Pel execution services are unavailable.'));
    if(!configure&&!['run','resume','status','cancel'].includes(command??''))return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','Use project configure --settings FILE.'));
    const flags:Record<string,string>={},seen=new Set<string>();let positional:string|undefined;
    const allowed=configure?['--settings']:command==='run'?['--state-root','--binding','--context']:command==='resume'?['--state-root','--decision','--revision']:['--state-root'];
    for(let i=configure?2:1;i<argv.length;i++){
      const arg=argv[i]!;
      if(arg.startsWith('--')){
        if(seen.has(arg))return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE',`Duplicate option ${arg}`));seen.add(arg);
        if(arg==='--json')continue;
        if(!allowed.includes(arg)||argv[i+1]===undefined||argv[i+1]!.startsWith('--'))return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE',`Unknown or incomplete option ${arg}`));
        flags[arg]=argv[++i]!;
      }else if(positional!==undefined||configure)return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','Unexpected positional argument.'));else positional=arg;
    }
    if(configure){
      if(!flags['--settings'])return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','Specify --settings FILE.'));
      yield* lifecycle.configure(yield* services.input.read(flags['--settings'],1048576));
      yield* services.output.stdout(json?' {"schemaVersion":1,"outcome":"configured"}\n'.trimStart():'Project configured.\n');return {exitCode:0 as const};
    }
    if(!positional)return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','Specify a program file or run ID.'));
    if(flags['--revision']&&!flags['--decision'])return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','A source revision requires its bound --decision record.'));
    const started=(runId:string)=>services.output.stderr(json?JSON.stringify({type:'run-started',runId,state:'running'})+'\n':`run-id: ${runId}\n`);
    const read=(name:string,max=1048576)=>flags[name]?services.input.read(flags[name]!,max):Effect.succeed(undefined);
    let result:RunStatusV1|RunResultV1;
    const stateRoot=flags['--state-root'];
    if(command==='run'){
      const source=yield* services.input.read(positional,1048576),binding=yield* read('--binding'),context=yield* read('--context',16777216);
      result=yield* lifecycle.run({source,sourcePath:positional,started,outputMode:json?'json':'text',...(stateRoot?{stateRoot}:{}),...(binding?{binding}:{}),...(context?{context}:{})});
    }else{
      const runId=decodeRunId(positional);if(typeof runId!=='string')return yield* Effect.fail(authoringFailure('PEL_CLI_USAGE','Invalid run ID.'));
      if(command==='resume'){
        const decision=yield* read('--decision'),revision=yield* read('--revision');
        result=yield* lifecycle.resume({runId,started,outputMode:json?'json':'text',...(stateRoot?{stateRoot}:{}),...(decision?{decision}:{}),...(revision?{revision}:{})});
      }else result=yield* (command==='cancel'?lifecycle.cancel(runId,stateRoot):lifecycle.status(runId,stateRoot));
    }
    const decoded = command==='run'||command==='resume'||'finalValue' in result ? decodeRunResultV1(result) : decodeRunStatusV1(result);
    if(!decoded.ok)return yield* Effect.fail(authoringFailure('PEL_RUN_RESULT','Execution returned an invalid result record.',1));
    if((command==='run'||command==='resume')&&pelLifecycleExit(result)===5)return yield* Effect.fail(authoringFailure('PEL_RUN_RESULT','Attached execution returned a pending observation.',1));
    let rendered=`${result.runId}: ${result.state}; external outcome: ${result.externalOutcome}\n`;
    if('diagnostics' in result){
      for(const d of result.diagnostics)rendered+=`${d.sourceSpan?`line ${d.sourceSpan.line}:${d.sourceSpan.column}: `:''}${d.code}: ${d.message}${d.effectId?` (effect ${d.effectId})`:''}\nNext action: ${d.nextAction}\nEvidence: ${JSON.stringify(d.evidenceRefs)}\n`;
      rendered+=`Final value: ${JSON.stringify(result.finalValue)}\nUsage: ${JSON.stringify(result.usage)}\nArtifacts: ${JSON.stringify(result.artifacts)}\nReceipts: ${JSON.stringify(result.receipts)}\nOutputs: ${JSON.stringify(result.outputs)}\n`;
    }
    yield* services.output.stdout(json?JSON.stringify(result)+'\n':rendered);
    return {exitCode:pelLifecycleExit(result)};
  }).pipe(Effect.catchAll(e=>Effect.gen(function*(){
    if(json)yield* services.output.stdout(JSON.stringify({schemaVersion:1,outcome:e.exitCode===2?'invalid':'failed',code:e.code,diagnostics:e.diagnostics??[{message:e.message}]})+'\n');
    else yield* services.output.stderr(`${e.code}: ${e.message}\n`);
    return {exitCode:e.exitCode};
  })));
}
