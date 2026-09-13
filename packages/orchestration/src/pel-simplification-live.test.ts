import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Effect} from 'effect';
import {readMetricRevision,readMetricChangedPaths} from './pel-simplification-live.js';
test('T-M6-010 metric collection reads exact Git bytes and records generated/test/archive totals separately',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foredi-metric-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('config','user.email','fixture@invalid');git('config','user.name','Fixture');
  for(const path of ['packages/pel/src','packages/pel/test','skills/foreman/runtime/dist','docs/research/pel-release/sources'])await mkdir(join(root,path),{recursive:true});
  await writeFile(join(root,'packages/pel/src/a.ts'),'// committed\n\nexport const a=1;\n');
  await writeFile(join(root,'packages/pel/test/a.test.ts'),'// test\n');
  await writeFile(join(root,'skills/foreman/runtime/dist/a.js'),'// generated\n');
  await writeFile(join(root,'docs/research/pel-release/sources/a.pdf'),Buffer.from([0xff,0,1]));
  git('add','.');git('commit','-qm','baseline');const first=git('rev-parse','HEAD');
  await writeFile(join(root,'packages/pel/src/a.ts'),'// second\n');git('add','.');git('commit','-qm','candidate');const second=git('rev-parse','HEAD');
  await writeFile(join(root,'packages/pel/src/a.ts'),'// uncommitted\n');
  const rows=await Effect.runPromise(readMetricRevision(root,first));
  assert.equal(Buffer.from(rows.find(f=>f.path==='packages/pel/src/a.ts')!.bytes).toString(),'// committed\n\nexport const a=1;\n');
  assert.equal(rows.length,4);assert.deepEqual([...await Effect.runPromise(readMetricChangedPaths(root,first,second))],['packages/pel/src/a.ts']);
  const invalid=await Effect.runPromise(readMetricRevision(root,'--help').pipe(Effect.either));assert.equal(invalid._tag,'Left');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('T-M6-010 known instruction membership excludes implementation source and marks the missing startup trace',async()=>{
 const {collectKnownInstructionMembership}=await import('./pel-simplification-live.js');
 const files=[
  ['skills/foreman/SKILL.md','Mandatory surviving skill.\r\n'],
  ['docs/guides/pel/quickstart.md','Mandatory quickstart.\n'],
  ['packages/orchestration/src/pel-host-task.ts',"const trustedInstructions='Rendered later';\n"],
  ['packages/orchestration/src/pel-authoring-cli.ts','export const unrelatedImplementation=true;\n'],
  ['packages/providers/src/profiles.ts','const profileMetadata={};\n'],
  ['examples/pel/profiles/grok-4.6.pel','(fm/task :model "grok-4.6")\n'],
  ['docs/guides/pel/research.md','Optional research tutorial.\n'],
 ].map(([path,content])=>({path:path!,bytes:Buffer.from(content!)}));
 const membership=collectKnownInstructionMembership(['skills/foreman/SKILL.md','skills/foreman/references/retired.md'],files);
 assert.deepEqual(membership.mandatoryInstructionFiles,['skills/foreman/SKILL.md','docs/guides/pel/quickstart.md']);
 assert.deepEqual(membership.optionalInstructionFiles,['docs/guides/pel/research.md','examples/pel/profiles/grok-4.6.pel']);
 assert.equal(membership.instructionCorpusComplete,false);
 assert.match(membership.countingNote,/source-bound startup trace/u);
 assert.match(membership.countingNote,/rendered.*prompt/u);
 assert.equal(files[0]!.bytes.toString(),'Mandatory surviving skill.\r\n');
 const reordered=collectKnownInstructionMembership(['skills/foreman/SKILL.md','skills/foreman/references/retired.md'],[...files].reverse());
 assert.deepEqual(reordered,membership);
});
