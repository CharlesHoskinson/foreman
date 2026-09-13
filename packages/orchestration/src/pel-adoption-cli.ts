/** Public adoption commands use the same product router and output ports. */
import {Effect} from 'effect';
import {authoringFailure,type AuthoringServices,type CliResult} from './pel-authoring-contract.js';
import {commandExitCode} from './pel-provider-cli.js';
import type {PelAdoptionFailure} from './pel-adoption.js';
export function runPelAdoptionCli(argv:readonly string[],services:AuthoringServices){return Effect.gen(function*(){
 const json=argv.includes('--json');
 const invalid=()=>authoringFailure('PEL_CLI_USAGE','Use foreman --version, foreman install rollback --to BUILD_ID, or foreman support export --run ID --out FILE.',2);
 const output=(text:string)=>services.output.stdout(text+'\n');
 const command=argv[0]==='--version'?'version':argv[0]==='install'&&argv[1]==='rollback'?'rollback':argv[0]==='support'&&argv[1]==='export'?'support':null;
 if(!command)return yield* Effect.fail(invalid());
 const flags=new Map<string,string|true>();const allowed=command==='version'?['--json']:command==='rollback'?['--to','--json']:['--run','--out','--json'];
 for(let index=command==='version'?1:2;index<argv.length;index++){
  const name=argv[index]!;if(!allowed.includes(name)||flags.has(name))return yield* Effect.fail(invalid());
  if(name==='--json'){flags.set(name,true);continue;}
  const value=argv[++index];if(!value||value.startsWith('--')||Buffer.byteLength(value)>4096||/[\u0000-\u001f\u007f]/u.test(value))return yield* Effect.fail(invalid());flags.set(name,value);
 }
 const build=flags.get('--to'),run=flags.get('--run'),out=flags.get('--out');
 if(command==='rollback'&&(typeof build!=='string'||!/^[a-f0-9]{64}$/u.test(build))||command==='support'&&(typeof run!=='string'||typeof out!=='string'))return yield* Effect.fail(invalid());
 if(!services.adoption)return yield* Effect.fail(authoringFailure('PEL_ADOPTION_UNAVAILABLE','The installed adoption service is unavailable.',2));
 const execute:Effect.Effect<{value:unknown;text:string},PelAdoptionFailure>=command==='version'?services.adoption.version().pipe(Effect.map(identity=>({value:identity,text:identity.version?`${identity.releaseName} ${identity.version} (build ${identity.buildId})`:`${identity.releaseName} (unversioned, build ${identity.buildId})`}))):command==='rollback'?services.adoption.rollback(build as string).pipe(Effect.map(value=>({value,text:JSON.stringify(value)}))):services.adoption.support(run as string,out as string).pipe(Effect.map(value=>({value,text:`Support bundle: ${value.out}\nSHA-256: ${value.sha256}`})));
 return yield* execute.pipe(Effect.flatMap(result=>output(json?JSON.stringify(result.value):result.text).pipe(Effect.as({exitCode:commandExitCode(command,'success')} satisfies CliResult))),Effect.catchAll(error=>{
  const outcome=error.exitCode===2?'invalid':error.exitCode===3?'needs-action':error.exitCode===4?'cancelled':'failed';
  return (json?output(JSON.stringify({error:{code:error.code,message:error.message}})):services.output.stderr(`${error.code}: ${error.message}\n`)).pipe(Effect.as({exitCode:commandExitCode(command,outcome)} satisfies CliResult));
 }));
});}
