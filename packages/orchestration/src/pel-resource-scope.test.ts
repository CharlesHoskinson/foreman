import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect, Deferred, Fiber } from 'effect';
import { canonicalWorkspacePath, makePelResourceScope } from './pel-resource-scope.js';
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
