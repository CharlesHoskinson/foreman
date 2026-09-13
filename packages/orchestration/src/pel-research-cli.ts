import {Effect} from 'effect';
import {authoringFailure,type AuthoringServices,type CliResult} from './pel-authoring-contract.js';
import {commandExitCode} from './pel-provider-cli.js';
import type {ResearchFailureV1,ResearchContextV1} from './pel-research-context.js';
function render(value:Omit<ResearchContextV1,'query'>){return [value.status,...value.results.map(row=>`${row.sourceLocator}\n${row.claimClass}; ${row.freshness}; SHA-256 ${row.sourceHash}\n${row.excerpt}`),...value.warnings].join('\n\n');}
export function runPelResearchCli(argv:readonly string[],services:AuthoringServices){return Effect.gen(function*(){
 const command=argv[1],json=argv.includes('--json'),invalid=()=>authoringFailure('PEL_CLI_USAGE','Use foreman research query TEXT [--limit 1..20] [--vault PATH], status [--vault PATH], or refresh --bundle DIRECTORY.',2);
 if(!['query','status','refresh'].includes(command??''))return yield* Effect.fail(invalid());
 const query=command==='query'?argv[2]:undefined;if(command==='query'&&(!query||query.startsWith('--')||!query.trim()||Buffer.byteLength(query)>4096))return yield* Effect.fail(invalid());
 const flags=new Map<string,string|true>(),allowed=command==='query'?['--json','--limit','--vault']:command==='status'?['--json','--vault']:['--json','--bundle'];
 for(let i=command==='query'?3:2;i<argv.length;i++){const key=argv[i]!;if(!allowed.includes(key)||flags.has(key))return yield* Effect.fail(invalid());if(key==='--json'){flags.set(key,true);continue;}const value=argv[++i];if(!value||value.startsWith('--')||Buffer.byteLength(value)>4096||/[\u0000-\u001f\u007f]/u.test(value))return yield* Effect.fail(invalid());flags.set(key,value);}
 const limit=flags.has('--limit')?Number(flags.get('--limit')):5,vault=flags.get('--vault'),bundle=flags.get('--bundle');
 if(!Number.isInteger(limit)||limit<1||limit>20||command==='refresh'&&typeof bundle!=='string')return yield* Effect.fail(invalid());
 const service=services.research;if(!service)return yield* Effect.fail(authoringFailure('PEL_RESEARCH_UNAVAILABLE','The research service is unavailable.',2));
 const selection=typeof vault==='string'?{vault}:{};
 const operation:Effect.Effect<{value:unknown;text:string},ResearchFailureV1>=command==='query'?service.query({query:query!,limit,...selection}).pipe(Effect.map(value=>({value,text:render(value)}))):command==='status'?service.status(selection).pipe(Effect.map(value=>({value,text:render(value)}))):service.refresh({bundle:bundle as string}).pipe(Effect.map(value=>({value,text:`Refreshed ${value.sourceCount} sources.\nSnapshot SHA-256: ${value.snapshotSha256}`})));
 const kind=command==='query'?'research-query':command==='status'?'research-status':'research-refresh';
 return yield* operation.pipe(Effect.flatMap(value=>services.output.stdout((json?JSON.stringify(value.value):value.text)+'\n').pipe(Effect.as({exitCode:commandExitCode(kind,'success')} satisfies CliResult))),Effect.catchAll(error=>{const outcome='outcome' in error?error.outcome:error.exitCode===2?'invalid':error.exitCode===4?'cancelled':'failed';return (json?services.output.stdout(JSON.stringify({error:{code:error.code,message:error.message}})+'\n'):services.output.stderr(`${error.code}: ${error.message}\n`)).pipe(Effect.as({exitCode:commandExitCode(kind,outcome)} satisfies CliResult));}));
});}
