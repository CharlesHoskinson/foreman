import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect, Deferred, Fiber } from 'effect';
import { canonicalWorkspacePath, makePelResourceScope, pelPublicationResource } from './pel-resource-scope.js';
import type { HostContextV1 } from './pel-run-contract.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pel-resources-'));
  await mkdir(join(root, 'real'));
  await symlink(join(root, 'real'), join(root, 'alias'));
  const info = await stat(root);
  const context = { workspace: { canonicalRoot: root, directoryIdentity: `${info.dev}:${info.ino}`, writablePaths: ['.'], grantId: 'grant', worktreeId: 'tree' }, binding: { limits: { maxConcurrentEffects: 1 } }, project: { workspaces: { grants: [], maxRaceContenders: 2 } } } as unknown as HostContextV1;
  return { root, context, cleanup: () => rm(root, { recursive: true, force: true }) };
}
test('T-M4-002 canonical aliases share identity and symlink escapes fail', async () => {
  const f = await fixture();
  try {
    assert.equal(await Effect.runPromise(canonicalWorkspacePath('alias/new', f.context)), join(f.root, 'real/new'));
    await symlink(tmpdir(), join(f.root, 'escape'));
    assert.equal((await Effect.runPromise(Effect.either(canonicalWorkspacePath('escape/out', f.context))))._tag, 'Left');
    assert.equal((await Effect.runPromise(Effect.either(canonicalWorkspacePath('../out', f.context))))._tag, 'Left');
  } finally { await f.cleanup(); }
});
test('T-M5-012 publication resources serialize exact destinations and reject unregistered identities',async()=>{
 const f=await fixture();try{await Effect.runPromise(Effect.gen(function*(){
  const destination={operation:'publish' as const,repositoryIdentitySha256:'a'.repeat(64),remoteIdentity:'/fixture/bare.git',ref:'refs/heads/reviewed',expectedOldObject:{kind:'absent' as const},authorityRef:{artifactId:'sha256-'+ 'b'.repeat(64),sha256:'b'.repeat(64),byteLength:1}},context={...f.context,project:{...f.context.project,destinations:{reviewed:destination}}},name=pelPublicationResource(destination),port=yield* makePelResourceScope();
  assert.equal((yield* Effect.scoped(Effect.either(port.acquire({reads:[],writes:['publication:'+ 'f'.repeat(64)]},context))))._tag,'Left');
  yield* Effect.scoped(port.acquire({reads:[],writes:[name]},context));
  const entered=yield* Deferred.make<void>();let second=false;
  const first=yield* Effect.fork(Effect.scoped(Effect.gen(function*(){yield* port.acquire({reads:[],writes:[name]},context);yield* Deferred.succeed(entered,undefined);yield* Effect.never;})));yield* Deferred.await(entered);
  const next=yield* Effect.fork(Effect.scoped(Effect.gen(function*(){yield* port.acquire({reads:[],writes:[name]},context);second=true;})));yield* Effect.yieldNow();assert.equal(second,false);yield* Fiber.interrupt(first);yield* Fiber.join(next);assert.equal(second,true);
 }));}finally{await f.cleanup();}
});
test('T-M4-007 read/read overlaps; conflicting writes wait; interruption releases complete set', async () => {
  const f = await fixture();
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const port = yield* makePelResourceScope();
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const path = join(f.root, 'real');
      const first = yield* Effect.fork(Effect.scoped(Effect.gen(function* () {
        yield* port.acquire({ reads: [path], writes: [] }, f.context);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      })));
      yield* Deferred.await(entered);
      yield* Effect.scoped(port.acquire({ reads: [path], writes: [] }, f.context));
      let wrote = false;
      const writer = yield* Effect.fork(Effect.scoped(Effect.gen(function* () {
        yield* port.acquire({ reads: [], writes: [path] }, f.context);
        wrote = true;
      })));
      yield* Effect.yieldNow();
      assert.equal(wrote, false);
      yield* Fiber.interrupt(first);
      yield* Fiber.join(writer);
      assert.equal(wrote, true);
      yield* Effect.scoped(port.acquireConcurrency(f.context));
      yield* Effect.scoped(port.acquireConcurrency(f.context));
    }));
  } finally { await f.cleanup(); }
});
test('T-M5-002 a coarse workspace write resolves only the admitted writable subpaths',async()=>{
 const f=await fixture();try{await Effect.runPromise(Effect.gen(function*(){const port=yield* makePelResourceScope(),context={...f.context,workspace:{...f.context.workspace,writablePaths:['real']}},descriptor={resources:{reads:['workspace:default'],writes:['workspace:default'],unknown:true}} as unknown as import('@foreman/pel').HostFunctionDescriptorV1,request={boundArguments:{}} as import('@foreman/pel').HostRequestV1;
  const resources=yield* port.resolve(descriptor,request,context);assert.deepEqual(resources.writes,[join(f.root,'real')]);assert.equal(resources.unknownScope,f.root);yield* Effect.scoped(port.acquire(resources,context));assert.equal((yield* Effect.scoped(Effect.either(port.acquire({reads:[],writes:[f.root]},context))))._tag,'Left');
 }));}finally{await f.cleanup();}
});
test('M6 research resolves only immutable index source artifacts with empty writes',async()=>{const {researchBytes}=await import('./pel-research-context.js'),{sha256Hex}=await import('@foreman/core');const f=await fixture();try{const sourceHash='c'.repeat(64),index=researchBytes({schemaVersion:1,bundleId:'bundle:release-sources',capturedAt:'2026-09-13T00:00:00Z',sources:[{id:'one',sourceLocator:'https://example.invalid/source',capturedAt:'2026-09-13T00:00:00Z',raw:{path:'source.md',sha256:sourceHash,byteLength:3},clean:{path:'source.md',sha256:sourceHash,byteLength:3},claimClass:'hypothesis',coverage:[]}],graph:null}),ref={artifactId:'sha256-'+sha256Hex(index),sha256:sha256Hex(index),byteLength:index.length},context={...f.context,checked:{snapshot:{policy:{allowedCapabilities:['research.read'],resourceEnvelope:{reads:['bundle:release-sources']}}}},project:{...f.context.project,researchBundles:{'bundle:release-sources':ref}}} as unknown as HostContextV1,descriptor={resources:{reads:[],writes:[],unknown:false}} as unknown as import('@foreman/pel').HostFunctionDescriptorV1,request={registryId:'fm/research',boundArguments:{bundle:{tag:'string',value:'bundle:release-sources'}}} as unknown as import('@foreman/pel').HostRequestV1;await Effect.runPromise(Effect.gen(function*(){const port=yield* makePelResourceScope({readResearchIndex:()=>Effect.succeed(index)}),resources=yield* port.resolve(descriptor,request,context);assert.deepEqual(resources,{reads:[`artifact:${ref.artifactId}`,`artifact:sha256-${sourceHash}`].sort(),writes:[]});yield* Effect.scoped(port.acquire(resources,context));assert.equal((yield* Effect.either(port.resolve(descriptor,{...request,boundArguments:{bundle:{tag:'string',value:'bundle:unknown'}}},context)))._tag,'Left');}));}finally{await f.cleanup();}});
