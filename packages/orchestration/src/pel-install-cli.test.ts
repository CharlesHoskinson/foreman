/** Compiled installation acceptance uses only a copied payload outside the source checkout. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Effect} from 'effect';
import {canonicalize} from '@foreman/core';
import * as tar from 'tar';
import {packageFixture} from './fixtures/pel-install/package-fixture.js';
import {writePelPackageArchive} from './pel-package.js';
const exec=promisify(execFile);
test('T-M6-001/002/017 compiled clean install exposes exact version, checks source, and rolls back without a checkout',async()=>{const f=await packageFixture();try{
 await cp('examples/pel',join(f.sourceRoot,'examples/pel'),{recursive:true});await cp('docs/guides/pel',join(f.sourceRoot,'docs/guides/pel'),{recursive:true});const original=await f.seal();const archive=await Effect.runPromise(writePelPackageArchive(f.sourceRoot,join(f.root,'archives'))),unpacked=join(f.root,'unpacked'),home=join(f.root,'home'),foremanHome=join(home,'.foreman');await mkdir(unpacked);await mkdir(foremanHome,{recursive:true});await writeFile(join(foremanHome,'projects.json'),canonicalize({schema:'foreman.project-registry.v1',generation:0,projects:[]})+'\n',{mode:0o600});await tar.x({file:archive.archivePath,cwd:unpacked});
 const run=(entry:string,args:readonly string[])=>exec(process.execPath,[entry,...args],{cwd:home,env:{PATH:process.env.PATH,HOME:home,FOREMAN_HOME:foremanHome},timeout:60000,maxBuffer:4*1024*1024});
 const installed=await run(join(unpacked,'runtime/dist/install.js'),['--prefix',f.prefix]);assert.equal(JSON.parse(installed.stdout).buildId,original.buildId);assert.equal(installed.stderr,'');const cli=join(f.prefix,'bin/foreman');const version=await run(cli,['--version','--json']);assert.deepEqual(JSON.parse(version.stdout),{releaseName:'Return of the ForeDi',version:null,buildId:original.buildId});assert.equal(version.stderr,'');const human=await run(cli,['--version']);assert.equal(human.stdout,`Return of the ForeDi (unversioned, build ${original.buildId})\n`);const checked=await run(cli,['check',join(unpacked,'examples/pel/implement-verify-review.pel'),'--json']);assert.equal(checked.stderr,'');assert.equal(JSON.parse(checked.stdout).tag,'ok');
 await writeFile(join(f.sourceRoot,'docs/guides/pel/install.md'),'second installed fixture build\n');const next=await f.seal('1.0.0');await run(join(f.sourceRoot,'runtime/dist/install.js'),['--prefix',f.prefix]);assert.equal(await readlink(join(f.prefix,'current')),`versions/${next.buildId}`);const rollback=await run(cli,['install','rollback','--to',original.buildId,'--json']);assert.equal(JSON.parse(rollback.stdout).buildId,original.buildId);assert.equal(await readlink(join(f.prefix,'current')),`versions/${original.buildId}`);const again=await run(cli,['--version','--json']);assert.equal(JSON.parse(again.stdout).buildId,original.buildId);
 }finally{await f.close();}});
