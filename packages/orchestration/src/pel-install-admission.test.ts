import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Effect} from 'effect';
import {packageFixture} from './fixtures/pel-install/package-fixture.js';
import {installPackage,withInstalledPrefix} from './pel-install.js';
import {makePelInstalledAdmission} from './pel-install-admission.js';

test('installed admission freezes invoking identity, preserves operation failures, and releases its lock',async()=>{
 const f=await packageFixture();try{
  await Effect.runPromise(installPackage({sourceRoot:f.sourceRoot,prefix:f.prefix}));
  const admission=makePelInstalledAdmission(pathToFileURL(join(f.prefix,'current/runtime/dist/foreman.js')).href,f.root);
  const failure={_tag:'InstallIoFailure',message:'operation-owned failure'};
  const result=await Effect.runPromise(admission(Effect.fail(failure)).pipe(Effect.either));assert.equal(result._tag,'Left');if(result._tag==='Left')assert.equal(result.left,failure);
  await Effect.runPromise(withInstalledPrefix(f.prefix,false,()=>Effect.void));
  await writeFile(join(f.sourceRoot,'docs/guides/pel/install.md'),'new current');await f.seal('1.0.0');await Effect.runPromise(installPackage({sourceRoot:f.sourceRoot,prefix:f.prefix}));
  let calls=0;const stale=await Effect.runPromise(admission(Effect.sync(()=>{calls++;})).pipe(Effect.either));assert.equal(stale._tag,'Left');assert.equal(calls,0);
 }finally{await f.close();}
});
test('checkout admission has no installation requirement and invalid invoking paths fail closed',async()=>{
 const f=await packageFixture();try{
 assert.equal(await Effect.runPromise(makePelInstalledAdmission(import.meta.url,f.root)(Effect.succeed(42))),42);
 let writes=0;const result=await Effect.runPromise(makePelInstalledAdmission('file:///missing/runtime.js',f.root)(Effect.sync(()=>{writes++;})).pipe(Effect.either));assert.equal(result._tag,'Left');assert.equal(writes,0);
 }finally{await f.close();}
});
