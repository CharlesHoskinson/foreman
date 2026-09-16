import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, chmod, rename, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Redacted } from 'effect';
import { makeLiveProviderCredentials } from './pel-provider-live.js';

const accountKey = 'https://auth.x.ai::fixture-client';
const account = () => ({ key: 'fixture-access-secret', auth_mode: 'oidc', user_id: 'fixture-user',
    create_time: '2026-09-01T00:00:00Z',
    principal_id: 'fixture-user', principal_type: 'user', oidc_issuer: 'https://auth.x.ai',
    oidc_client_id: 'fixture-client', expires_at: new Date(Date.now() + 3600000).toISOString(),
    refresh_token: 'fixture-refresh-secret', email: 'private@example.invalid', first_name: 'Private' });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'pel-grok-auth-test-'));
    const profile = join(root, '.grok');
    await mkdir(profile, { mode: 0o700 });
    const file = join(profile, 'auth.json');
    const write = (value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 });
    await write({ [accountKey]: account() });
    const resolve = () => Effect.scoped(makeLiveProviderCredentials({ userHome: root,
        stateRoot: join(root, 'state'), worktreeRoot: join(root, 'work'), environment: {} },
    'grok-acp').resolve('native:grok:default'));
    return { root, profile, file, write, resolve, close: () => rm(root, { recursive: true, force: true }) };
}
test('native Grok resolves a host snapshot capability without exposing the profile', async () => {
    const f = await fixture();
    try {
        const material = await Effect.runPromise(f.resolve());
        assert.ok(material.grokLogin, 'native Grok needs a host-owned snapshot capability');
        assert.equal(material.nativeProfileDirectory, undefined);
        assert.equal(material.environment, undefined);
        const snapshot = await Effect.runPromise(material.grokLogin.snapshot({ deadline: Date.now() + 10000 }));
        const parsed = JSON.parse(Redacted.value(snapshot));
        assert.equal(parsed[accountKey].key, 'fixture-access-secret');
        assert.equal(parsed[accountKey].create_time, '2026-09-01T00:00:00Z');
        assert.equal(parsed[accountKey].refresh_token, undefined);
        assert.equal(parsed[accountKey].email, undefined);
        assert.equal(parsed[accountKey].first_name, undefined);
        assert.ok(!JSON.stringify({ material, snapshot }).includes('fixture-access-secret'));
    } finally { await f.close(); }
});
test('native Grok refuses malformed, ambiguous, expired and insecure account files', async () => {
    for (const kind of ['malformed', 'ambiguous', 'expired', 'permissions', 'symlink', 'hardlink', 'oversize', 'duplicate']) {
        const f = await fixture();
        try {
            if (kind === 'malformed') await writeFile(f.file, '{');
            if (kind === 'ambiguous') await f.write({ [accountKey]: account(), other: account() });
            if (kind === 'expired') await f.write({ [accountKey]: { ...account(), expires_at: '2000-01-01T00:00:00Z' } });
            if (kind === 'permissions') await chmod(f.file, 0o644);
            if (kind === 'symlink') { await rename(f.file, join(f.root, 'other')); await symlink(join(f.root, 'other'), f.file); }
            if (kind === 'hardlink') await link(f.file, join(f.root, 'other'));
            if (kind === 'oversize') await writeFile(f.file, 'x'.repeat(65537));
            if (kind === 'duplicate') await writeFile(f.file, `{"${accountKey}":${JSON.stringify(account())},"${accountKey}":${JSON.stringify(account())}}`);
            const result = await Effect.runPromise(f.resolve().pipe(Effect.either));
            assert.equal(result._tag, 'Left', kind);
            if (result._tag === 'Left') assert.equal(result.left._tag, 'AuthenticationRequired');
            assert.ok(!JSON.stringify(result).includes('fixture-refresh-secret'));
        } finally { await f.close(); }
    }
});
test('native Grok pins account identity and requires validity through the deadline', async () => {
    const f = await fixture();
    try {
        const material = await Effect.runPromise(f.resolve());
        assert.ok(material.grokLogin);
        const deadline = Date.now() + 7200000;
        assert.equal((await Effect.runPromise(material.grokLogin.snapshot({ deadline }).pipe(Effect.either)))._tag, 'Left');
        await f.write({ [accountKey]: { ...account(), user_id: 'another-user' } });
        assert.equal((await Effect.runPromise(material.grokLogin.snapshot({ deadline: Date.now() + 1000 }).pipe(Effect.either)))._tag, 'Left');
    } finally { await f.close(); }
});
