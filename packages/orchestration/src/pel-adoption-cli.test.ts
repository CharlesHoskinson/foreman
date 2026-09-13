import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Effect} from 'effect';
import {makeForemanCli} from './pel-authoring-cli.js';
import type {AuthoringServices} from './pel-authoring-contract.js';
function fixture(exitCode?:1|2|3|4){
 let output='',calls=0;const run=<T>(value:T)=>Effect.suspend(()=>{calls++;return exitCode?Effect.fail({_tag:'PelAdoptionFailure' as const,code:'TEST_FAILURE',message:'Fixture outcome.',exitCode}):Effect.succeed(value);});
 const services={input:{read:()=>Effect.die('unexpected input')},output:{stdout:(s:string)=>Effect.sync(()=>{output+=s;}),stderr:(s:string)=>Effect.sync(()=>{output+=s;})},context:{defaultSnapshotPath:'unused'},adoption:{version:()=>run({releaseName:'Return of the ForeDi',version:null,buildId:'a'.repeat(64)}),rollback:(buildId:string)=>run({buildId}),support:(id:string,out:string)=>run({out,sha256:'b'.repeat(64)})}};
 return {cli:makeForemanCli(services as unknown as AuthoringServices),output:()=>output,calls:()=>calls};
}
test('T-M6-021 installed version uses exact nullable identity in JSON and readable human output',async()=>{
 const f=fixture();assert.equal((await Effect.runPromise(f.cli.run(['--version','--json']))).exitCode,0);assert.deepEqual(JSON.parse(f.output()),{releaseName:'Return of the ForeDi',version:null,buildId:'a'.repeat(64)});
 const h=fixture();await Effect.runPromise(h.cli.run(['--version']));assert.match(h.output(),/Return of the ForeDi \(unversioned, build a{64}\)/u);
});
for(const [name,args,codes]of[['rollback',['install','rollback','--to','a'.repeat(64),'--json'],[1,2,3,4]],['support',['support','export','--run','run-1','--out','support.json','--json'],[1,2,4]],['version',['--version','--json'],[1,2]]] as const){
 test(`T-M6-021 ${name} routes its reachable outcomes`,async()=>{const good=fixture();assert.equal((await Effect.runPromise(good.cli.run(args))).exitCode,0);for(const code of codes){const f=fixture(code);assert.equal((await Effect.runPromise(f.cli.run(args))).exitCode,code);assert.equal(JSON.parse(f.output()).error.code,'TEST_FAILURE');}});
}
test('T-M6-021 malformed adoption commands fail before invoking services',async()=>{
 for(const args of [['install','rollback','--to','bad'],['install','rollback','--to','a'.repeat(64),'--to','b'.repeat(64)],['support','export','--run','run-1'],['--version','--unknown'],['support','export','--run','run-1','--out','a','extra']]){const f=fixture();const result=await Effect.runPromise(f.cli.run(args).pipe(Effect.either));assert.ok(result._tag==='Left'||result.right.exitCode===2);assert.equal(f.calls(),0);}
});
test('T-M6-001 compiled command follows the installed foreman symlink entry',async()=>{
 const {mkdtemp,symlink,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const root=await mkdtemp(join(tmpdir(),'foredi-entry-'));try{const link=join(root,'foreman');await symlink(resolve('skills/foreman/runtime/dist/foreman.js'),link);const result=spawnSync(process.execPath,[link,'check',join(root,'missing.pel')],{encoding:'utf8',cwd:root,timeout:15000});assert.equal(result.status,2,result.stdout+result.stderr);assert.match(result.stderr,/PEL_INPUT/u);}finally{await rm(root,{recursive:true,force:true});}
});
