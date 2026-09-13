import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {validateSimplificationBaseline,measureSimplification,productionClass,selectCandidateProduction,type MetricFile} from './pel-simplification.js';
const frozen=readFileSync(resolve('docs/release-metrics/foredi-baseline.json'),'utf8');
const baseline=JSON.parse(frozen);
const original:MetricFile[]=[...baseline.production,...baseline.instructions].map((row:{path:string})=>({path:row.path,bytes:execFileSync('git',['show',`${baseline.baselineCommit}:${row.path}`],{maxBuffer:1048576})}));
test('T-M6-010 fixed manifest rejects changed membership, tokenizer, counts and rules',()=>{
 assert.equal(validateSimplificationBaseline(frozen).ok,true);
 for(const change of [(v:any)=>v.production.pop(),(v:any)=>v.production.reverse(),(v:any)=>v.tokenizer.version='1.0.22',(v:any)=>v.countingRule='skip-comments',(v:any)=>v.targets.glueReduction=0,(v:any)=>v.totals.productionNonblankLines--]){
  const value=JSON.parse(frozen);change(value);assert.equal(validateSimplificationBaseline(JSON.stringify(value)).ok,false);
 }
});
test('T-M6-010 candidate union counts new research and other moved production, full residual files once',()=>{
 const paths=['skills/foreman/scripts/watch.sh','packages/pel/src/evaluate.ts','packages/providers/src/profile.ts','packages/orchestration/src/pel-research-host.ts','packages/orchestration/src/pel-install.ts','packages/orchestration/src/pel-simplification.ts','scripts/new-controller.ts','packages/unchanged/src/a.ts','packages/pel/test/parser.test.ts','packages/orchestration/src/fixtures/pel-adoption/fixture.ts','skills/foreman/runtime/dist/foreman.js','docs/research/pel-release/sources/raw.py'];
 const selected=selectCandidateProduction(paths,new Set(['packages/orchestration/src/pel-research-host.ts','packages/orchestration/src/pel-install.ts','packages/orchestration/src/pel-simplification.ts','scripts/new-controller.ts','packages/pel/test/parser.test.ts','docs/research/pel-release/sources/raw.py']));
 assert.deepEqual(selected,[...paths.slice(0,7)].sort());
 assert.equal(productionClass(paths[8]!),'test');assert.equal(productionClass(paths[10]!),'generated');assert.equal(productionClass(paths[11]!),'archive');
});
test('T-M6-011 valid missed targets remain measured failures; full surviving instructions are counted',()=>{
 const result=measureSimplification({baselineText:frozen,baselineFiles:original,candidateCommit:'a'.repeat(40),candidateFiles:[...original,{path:'docs/guides/pel/quickstart.md',bytes:Buffer.from('Start the standard workflow.\n')},{path:'packages/orchestration/src/pel-research-host.ts',bytes:Buffer.from('// source\n\nexport const read = 1;\n')}],changedPaths:new Set(['packages/orchestration/src/pel-research-host.ts','docs/guides/pel/quickstart.md']),mandatoryInstructionFiles:[],optionalInstructionFiles:[]});
 assert.equal(result.ok,true);if(!result.ok)return;
 assert.equal(result.value.baseline.productionNonblankLines,6916);assert.equal(result.value.candidate.productionNonblankLines,6918);
 assert.equal(result.value.acceptance.glue,false);assert.equal(result.value.acceptance.instructions,false);assert.equal(result.value.exitCode,1);
 assert.equal(result.value.instructions.requiredFiles.length,6);assert.ok(result.value.candidate.requiredInstructionTokens!==null&&result.value.candidate.requiredInstructionTokens>16502);
 assert.equal(result.value.production.files.find(row=>row.path.endsWith('pel-research-host.ts'))?.nonblankLines,2);
});
test('T-M6-010 corrupt original bytes and missing mandatory instruction carriers fail comparison',()=>{
 const input={baselineText:frozen,baselineFiles:original,candidateCommit:'a'.repeat(40),candidateFiles:original,changedPaths:new Set<string>(),mandatoryInstructionFiles:['missing-profile.pel'],optionalInstructionFiles:[]};
 assert.equal(measureSimplification(input).ok,false);
 assert.equal(measureSimplification({...input,mandatoryInstructionFiles:[],baselineFiles:original.map((f,i)=>i?f:{...f,bytes:Buffer.from('changed')})}).ok,false);
});

test("T-M6-010 an arbitrary sources directory cannot hide added production",()=>{assert.deepEqual(selectCandidateProduction(["packages/new/sources/controller.ts"],new Set(["packages/new/sources/controller.ts"])),["packages/new/sources/controller.ts"]);});
test('T-M6-010 duplicate baseline keys are invalid even when their values agree',()=>{assert.equal(validateSimplificationBaseline(frozen.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1')).ok,false);});
test('T-M6-010 a generated directory name cannot hide new TypeScript implementation',()=>{
 const paths=['packages/new/generated/controller.ts','packages/new/dist/controller.ts','packages/new/dist-custom/controller.ts'];
 assert.deepEqual(selectCandidateProduction(paths,new Set(paths)),[...paths].sort());
 assert.equal(productionClass('skills/foreman/runtime/dist/foreman.js'),'generated');
 assert.equal(productionClass('packages/pel/dist/parser.d.ts'),'generated');
});
test('T-M6-011 incomplete startup instructions retain production counts without inventing a reduction',()=>{
 const result=measureSimplification({baselineText:frozen,baselineFiles:original,candidateCommit:'a'.repeat(40),candidateFiles:[...original,{path:'docs/guides/pel/quickstart.md',bytes:Buffer.from('Start the workflow.\n')}],changedPaths:new Set(),mandatoryInstructionFiles:[],optionalInstructionFiles:[],instructionCorpusComplete:false});
 assert.equal(result.ok,true);if(!result.ok)return;
 assert.equal(result.value.candidate.productionNonblankLines,6916);assert.equal(result.value.instructions.complete,false);assert.ok(result.value.instructions.knownRequiredTokens>16502);assert.equal(result.value.candidate.requiredInstructionTokens,null);assert.equal(result.value.ratios.instructionReduction,null);assert.equal(result.value.acceptance.instructions,false);assert.equal(result.value.exitCode,1);
});
test('T-M6-010 rendered startup bytes add instruction tokens without changing production totals',async()=>{
 const {makeStandardStartTrace,validateStandardStartTrace,standardStartCommands}=await import('./pel-simplification-trace.js');
 const files=[...original,{path:'docs/guides/pel/quickstart.md',bytes:Buffer.from('Full quickstart.\r\n')},{path:'examples/pel/implement-verify-review.pel',bytes:Buffer.from('(print "start")\n')}];
 const input={baselineText:frozen,baselineFiles:original,candidateCommit:'a'.repeat(40),candidateFiles:files,changedPaths:new Set<string>(),mandatoryInstructionFiles:[],optionalInstructionFiles:[],instructionCorpusComplete:false};
 const partial=measureSimplification(input);assert.equal(partial.ok,true);if(!partial.ok)return;
 const trace=makeStandardStartTrace({candidateCommit:input.candidateCommit,candidateFiles:files,evidenceKind:'test-fixture',commands:standardStartCommands.map((argv,index)=>({argv,stdout:index===4?'':'Actual command output.\n',stderr:'',exitCode:index===4?null:0})),provider:{profileId:'grok-4.6',transportId:'grok-acp',protocolVersion:'fixture-native-v1'},instructions:[{channel:'grok-system-override',text:'Actual provider instructions.\r\n'},{channel:'grok-output-schema',text:'{"type":"object"}'},{channel:'grok-session-prompt',text:'{"artifacts":[],"outputSchema":{}}'}]});
 const validated=validateStandardStartTrace(trace,input.candidateCommit,files);assert.equal(validated.ok,true);if(!validated.ok)return;
 const result=measureSimplification({...input,instructionCorpusComplete:true,startupTrace:validated.value});assert.equal(result.ok,true);if(!result.ok)return;
 assert.deepEqual(result.value.production,partial.value.production);assert.ok(result.value.instructions.knownRequiredTokens>partial.value.instructions.knownRequiredTokens);assert.equal(result.value.instructions.complete,true);assert.equal(result.value.startupTrace?.evidenceKind,'test-fixture');assert.equal(result.value.operational.commandsAfterPrerequisites,3);assert.equal(result.value.operational.authoritativeHistories,null);assert.ok(result.value.instructions.requiredFiles.some(row=>row.path==='startup-trace/provider-0-grok-system-override.txt'));
});
