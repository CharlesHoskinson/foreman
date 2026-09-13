import {Effect} from 'effect';
import {authoringFailure,type AuthoringServices,type CliResult} from './pel-authoring-contract.js';
import {commandExitCode} from './pel-provider-cli.js';
export function runPelMigrationCli(argv:readonly string[],services:AuthoringServices){return Effect.gen(function*(){
 const input=argv[1],json=argv.includes('--json'),invalid=()=>authoringFailure('PEL_CLI_USAGE','Use foreman migrate ROUND.json --contract CONTRACT.json --out WORKFLOW.pel [--json].',2);
 if(!input||input.startsWith('--'))return yield* Effect.fail(invalid());const flags=new Map<string,string|true>();
 for(let i=2;i<argv.length;i++){const key=argv[i]!;if(!['--contract','--out','--json'].includes(key)||flags.has(key))return yield* Effect.fail(invalid());if(key==='--json'){flags.set(key,true);continue;}const value=argv[++i];if(!value||value.startsWith('--')||Buffer.byteLength(value)>4096||/[\u0000-\u001f\u007f]/u.test(value))return yield* Effect.fail(invalid());flags.set(key,value);}
 const contract=flags.get('--contract'),out=flags.get('--out');if(typeof contract!=='string'||typeof out!=='string'||!out.endsWith('.pel'))return yield* Effect.fail(invalid());
 if(!services.migration)return yield* Effect.fail(authoringFailure('PEL_MIGRATION_UNAVAILABLE','The installed migration service is unavailable.',2));
 return yield* services.migration.migrate({input,contract,out}).pipe(Effect.flatMap(value=>services.output.stdout((json?JSON.stringify(value):`Pel source: ${value.outputPath}\nParity report: ${value.parityPath}`)+'\n').pipe(Effect.as({exitCode:commandExitCode('migrate','success')} satisfies CliResult))),Effect.catchAll(error=>{const outcome=error.exitCode===2?'invalid':error.exitCode===3?'needs-action':error.exitCode===4?'cancelled':'failed';return (json?services.output.stdout(JSON.stringify({error})+'\n'):services.output.stderr(`${error.code}: ${error.message}\n`)).pipe(Effect.as({exitCode:commandExitCode('migrate',outcome)} satisfies CliResult));}));
});}
