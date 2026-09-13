import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Effect} from 'effect';
import {registerProjectFileV1} from './project-registry.js';
import {resolvePelRegisteredRoot} from './pel-registered-root.js';
test('T-M4-015 registered root resolves without project.json and refuses an unregistered override',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pel-root-')),cwd=join(root,'repo'),home=join(root,'home'),state=join(root,'state');
  try{
    for(const path of [cwd,home,state])mkdirSync(path);execFileSync('git',['init','-q',cwd]);
    const registered=registerProjectFileV1(join(home,'projects.json'),{project_id:'11111111-1111-4111-8111-111111111111',operation_id:'22222222-2222-4222-8222-222222222222',git_common_dir:join(cwd,'.git'),worktree_path:cwd,store_backend:'sqlite',store_location:state});
    assert.equal(registered._tag,'Registered');
    const found=await Effect.runPromise(resolvePelRegisteredRoot(cwd,home));assert.equal(found.stateRoot,state);
    assert.equal((await Effect.runPromise(Effect.either(resolvePelRegisteredRoot(cwd,home,root))))._tag,'Left');
  }finally{rmSync(root,{recursive:true,force:true});}
});
