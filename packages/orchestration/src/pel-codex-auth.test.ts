import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Queue, Redacted, Stream } from 'effect';
import type { NativeProcessPort } from '@foreman/providers';
import { makeCodexChatGptCredential } from './pel-codex-auth.js';
import { makeLiveProviderCredentials } from './pel-provider-live.js';

const auth = (account = 'account-one') => JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'private-access-fixture', refresh_token: 'private-refresh-fixture', id_token: 'private-id-fixture', account_id: account } });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'pel-chatgpt-auth-'));
    const home = join(root, 'user');
    const profile = join(home, '.codex');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const file = join(profile, 'auth.json');
    await writeFile(file, auth(), { mode: 0o600 });
    const context = { stateRoot: join(root, 'state'), worktreeRoot: join(root, 'workspace'), userHome: home, environment: {} };
    return { root, profile, file, context, service: makeLiveProviderCredentials(context, 'codex-app-server'), close: () => rm(root, { recursive: true, force: true }) };
}
test('native Codex credential resolution returns host tokens without a profile mount or API key', async () => {
    const f = await fixture();
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const material = yield* f.service.resolve('native:codex:default');
            assert.ok(material.chatgpt, 'native login must supply the host token capability');
            assert.equal(material.nativeProfileDirectory, undefined);
            assert.equal(material.environment, undefined);
            const tokens = yield* material.chatgpt.tokens({ refresh: false, deadline: Date.now() + 5000 });
            assert.equal(Redacted.value(tokens.accessToken), 'private-access-fixture');
            assert.equal(tokens.chatgptAccountId, 'account-one');
            assert.doesNotMatch(JSON.stringify({ material, tokens }), /private-access-fixture|private-refresh-fixture|private-id-fixture/);
        })));
    } finally { await f.close(); }
});
for (const scenario of ['success', 'changed-account', 'error', 'timeout'] as const) test(`host-managed refresh preserves its account and releases its subprocess: ${scenario}`, async () => {
    const f = await fixture();
    try {
        let closed = false;
        const sent: Record<string, unknown>[] = [];
        const processPort: NativeProcessPort = { open: launch => Effect.gen(function* () {
            assert.equal(launch.environment.CODEX_HOME, f.profile);
            assert.equal(launch.environment.OPENAI_API_KEY, undefined);
            const queue = yield* Queue.unbounded<Record<string, unknown>>();
            yield* Effect.addFinalizer(() => Queue.shutdown(queue));
            return { close: () => Effect.sync(() => { closed = true; }), events: Stream.fromQueue(queue), send: frame => Effect.gen(function* () {
                sent.push(frame);
                if (scenario === 'timeout') return;
                if (frame.method === 'initialize') yield* Queue.offer(queue, { id: frame.id, result: {} });
                if (frame.method === 'account/read') {
                    assert.deepEqual(frame.params, { refreshToken: true });
                    if (scenario === 'error') yield* Queue.offer(queue, { id: frame.id, error: { message: 'private-refresh-fixture' } });
                    else {
                        yield* Effect.promise(() => writeFile(f.file, auth(scenario === 'changed-account' ? 'account-two' : 'account-one').replace('private-access-fixture', 'private-refreshed-fixture')));
                        yield* Queue.offer(queue, { id: frame.id, result: { account: { type: 'chatgpt' } } });
                    }
                }
            }) };
        }) };
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const material = yield* makeCodexChatGptCredential(f.profile, f.context, { process: processPort, installed: { executable: '/fake/codex', nodeExecutable: process.execPath, bwrapPath: '/usr/bin/bwrap', version: 'fixture', identityRevision: 'fixture', readOnlyRuntimeRoots: [] } });
            assert.ok(material.chatgpt);
            return yield* material.chatgpt.tokens({ refresh: true, previousAccountId: 'account-one', deadline: Date.now() + (scenario === 'timeout' ? 100 : 3000) });
        })).pipe(Effect.either));
        assert.equal(closed, true);
        assert.equal(result._tag, scenario === 'success' ? 'Right' : 'Left');
        if (result._tag === 'Right') assert.equal(Redacted.value(result.right.accessToken), 'private-refreshed-fixture');
        assert.doesNotMatch(JSON.stringify(result), /private-/);
        assert.doesNotMatch(JSON.stringify(sent), /private-|thread\/start|turn\/start/);
    } finally { await f.close(); }
});
for (const scenario of ['missing', 'symlink', 'malformed', 'oversized', 'mode', 'profile-mode', 'non-chatgpt', 'directory', 'duplicate-keys'] as const) test(`native Codex auth rejects ${scenario} before dispatch`, async () => {
    const f = await fixture();
    try {
        if (scenario === 'missing' || scenario === 'symlink' || scenario === 'directory') await rm(f.file);
        if (scenario === 'symlink') { await writeFile(join(f.root, 'other.json'), auth(), { mode: 0o600 }); await symlink(join(f.root, 'other.json'), f.file); }
        if (scenario === 'directory') await mkdir(f.file);
        if (scenario === 'malformed') await writeFile(f.file, 'private-invalid-json');
        if (scenario === 'oversized') await writeFile(f.file, 'x'.repeat(65537));
        if (scenario === 'mode') await chmod(f.file, 0o644);
        if (scenario === 'profile-mode') await chmod(f.profile, 0o777);
        if (scenario === 'non-chatgpt') await writeFile(f.file, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'private-key-fixture' }));
        if (scenario === 'duplicate-keys') await writeFile(f.file, '{"auth_mode":"apikey",' + auth().slice(1));
        const result = await Effect.runPromise(Effect.scoped(f.service.resolve('native:codex:default')).pipe(Effect.either));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') { assert.equal(result.left._tag, 'AuthenticationRequired'); assert.doesNotMatch(JSON.stringify(result.left), /private-/); }
    } finally { await f.close(); }
});
test('native token callback pins the initial account and rejects changed storage or an expired deadline', async () => {
    const f = await fixture();
    try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const material = yield* f.service.resolve('native:codex:default');
            assert.ok(material.chatgpt);
            yield* Effect.promise(() => writeFile(f.file, auth('account-two')));
            const changed = yield* material.chatgpt.tokens({ refresh: false, deadline: Date.now() + 5000 }).pipe(Effect.either);
            assert.equal(changed._tag, 'Left');
            const expired = yield* material.chatgpt.tokens({ refresh: false, deadline: Date.now() - 1 }).pipe(Effect.either);
            assert.equal(expired._tag, 'Left');
        })));
    } finally { await f.close(); }
});
